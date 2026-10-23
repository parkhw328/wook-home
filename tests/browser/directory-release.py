"""Synthetic layer-preview server only; never run against real office data."""
import json, os, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE=f"http://127.0.0.1:{os.environ.get('LAYER_TEST_PORT','18086')}"
OUT=Path('artifacts/directory-release');OUT.mkdir(parents=True,exist_ok=True)
results=[]
def check(page, label, agent):
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE)
    page.locator('#room-navigation [data-room="office"]').click()
    expect(page.locator('#room-heading')).to_have_text('사무실')
    metrics=page.evaluate('''()=>{const d=document.querySelector('.office-directory'),r=document.querySelector('#room-content'),f=document.querySelector('.floor-directory');return {width:innerWidth,directoryWidth:d.getBoundingClientRect().width,directoryScroll:getComputedStyle(d).overflowY,roomHeight:r.clientHeight,roomMaxHeight:parseFloat(getComputedStyle(r).maxHeight)||0,floorHeight:f.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth+1,minFont:Math.min(...[...document.querySelectorAll('.floor-directory button,.room-panel p,.room-panel strong')].filter(e=>e.checkVisibility()).map(e=>parseFloat(getComputedStyle(e).fontSize)))}}''')
    assert not metrics['overflow'] and metrics['minFont']>=14,metrics
    if metrics['width']>1100:
        assert metrics['directoryWidth']>=360 and metrics['directoryScroll']=='visible' and metrics['roomMaxHeight']>=448 and metrics['floorHeight']<320,metrics
    else: assert page.locator('#room-content').evaluate('e=>getComputedStyle(e).overflowY')=='visible'
    page.locator('#room-panel').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/f'{label}-layout.png'))
    page.locator('#workbench-empty [data-workbench-connections]').click()
    page.locator(f'#modal-body [data-stat-agent="{agent}"]').click()
    page.locator('[data-release-agent]').click()
    page.locator('[data-confirm-release]').focus();page.keyboard.press('Enter')
    expect(page.locator('#modal-title')).to_have_text('직원 등록 해제 기록')
    expect(page.locator('#modal-body')).to_contain_text('보존할 업무 메모')
    assert not any(a['id']==agent for a in page.request.get(BASE+'/api/state').json()['agents'])
    page.locator(f'[data-restore-agent="{agent}"]').click()
    expect(page.locator('[data-release-agent]')).to_be_visible()
    state=page.request.get(BASE+'/api/state').json()
    restored=next(a for a in state['agents'] if a['id']==agent)
    assert restored['workArchive']['note']=='보존할 업무 메모' and 'connection' not in restored
    page.screenshot(path=str(OUT/f'{label}-staff.png'))
    page.keyboard.press('Escape');assert not errors,errors
    results.append({'case':label,**metrics})
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,args=['--no-sandbox'])
    setup=b.new_page();a=setup.request.post(BASE+'/api/agents',data={'name':'등록 해제 검증','role':'검증','provider':'openai'}).json()
    setup.request.put(BASE+f'/api/agents/{a["id"]}/archive',data={'stored':True,'note':'보존할 업무 메모','settingsRevision':0})
    for i in range(10):setup.request.post(BASE+'/api/agents',data={'name':f'목록 공간 검증 {i}','role':'긴 직원 목록과 설명 검증','provider':'openai'})
    setup.close()
    for theme in ['light','dark']:
        for width in [320,390,768,1366,1920]:
            page=b.new_page(viewport={'width':width,'height':1000},color_scheme=theme,reduced_motion='reduce')
            check(page,f'{theme}-{width}',a['id']);page.close()
    b.close()
    ext=Path('extensions/browser-observer').resolve()
    for theme in ['light','dark']:
        with tempfile.TemporaryDirectory() as profile:
            c=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,viewport={'width':1366,'height':1000},color_scheme=theme,reduced_motion='reduce',args=['--no-sandbox',f'--disable-extensions-except={ext}',f'--load-extension={ext}'])
            page=c.pages[0];page.goto(BASE)
            worker=c.service_workers[0] if c.service_workers else c.wait_for_event('serviceworker')
            assert worker.evaluate('''async()=>{const [t]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(t.id,2);return chrome.tabs.getZoom(t.id)}''')==2
            check(page,f'{theme}-zoom200',a['id']);c.close()
print(json.dumps(results,ensure_ascii=False),flush=True)
(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
