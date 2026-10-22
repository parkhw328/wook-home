"""Only run against the synthetic layer-preview.mjs server."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE=f"http://127.0.0.1:{os.environ.get('LAYER_TEST_PORT', '18084')}"
OUT=Path('artifacts/work-archive'); OUT.mkdir(parents=True, exist_ok=True)
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1366,'height':1000},reduced_motion='reduce')
    errors=[];page.on('pageerror', lambda e:errors.append(str(e)))
    page.goto(BASE)
    page.locator('#workbench-empty [data-workbench-connections]').click()
    expect(page.locator('#modal-title')).to_have_text('업무와 연결 선택')
    page.locator('#modal-body [data-archive-session]').last.click()
    page.locator('#archive-note').fill('완료: 검토\n남음: 연결 후 후속 검증 <b>텍스트</b>')
    page.locator('#archive-form [value="store"]').click()
    expect(page.locator('#modal-body [data-archive-agent]')).to_be_visible()
    state=page.request.get(BASE+'/api/state').json()
    agent=next(a for a in state['agents'] if a.get('workArchive',{}).get('stored'))
    aid=agent['id'];sid=agent['connection']['sessionId']
    # Server blocks a new instruction to a stored session before it reaches a bridge.
    response=page.request.post(BASE+f'/api/local-sessions/{sid}/commands',data={'id':'12345678-1234-4234-8234-123456789012','content':'검증 지시'})
    assert response.status==409 and response.json()['error']['code']=='WORK_ARCHIVED'
    page.keyboard.press('Escape')
    for theme in ['light','dark']:
        for width in [320,390,768,1366,1920]:
            page.set_viewport_size({'width':width,'height':1000})
            # Use the product's actual theme picker.
            page.locator('#theme-choice').select_option(theme)
            page.locator('#room-navigation [data-room="warehouse"]').click()
            expect(page.locator('#room-heading')).to_have_text('창고')
            expect(page.locator('#room-content')).to_contain_text('창고 보관 중')
            assert page.locator('#room-content b').count()==0
            page.locator(f'#room-content [data-archive-agent="{aid}"]').click()
            expect(page.locator('#archive-note')).to_be_visible()
            page.locator('#archive-note').fill('다음 검증 '+theme+str(width))
            page.keyboard.press('Escape')
            page.locator(f'#room-content [data-archive-agent="{aid}"]').click()
            expect(page.locator('#archive-note')).to_have_value('다음 검증 '+theme+str(width))
            metrics=page.locator('#modal').evaluate('''d=>({overflow:d.scrollWidth>d.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,minFont:Math.min(...[...d.querySelectorAll('p,label,textarea,button')].filter(e=>e.checkVisibility()).map(e=>parseFloat(getComputedStyle(e).fontSize))),controls:[...d.querySelectorAll('button,textarea')].filter(e=>e.checkVisibility()).every(e=>e.getBoundingClientRect().height>=44)})''')
            assert not metrics['overflow'] and metrics['minFont']>=14 and metrics['controls'],metrics
            page.locator('#archive-form [value="store"]').click()
            expect(page.locator('#modal-body [data-archive-agent]')).to_be_visible()
            page.keyboard.press('Escape')
            page.screenshot(path=str(OUT/f'{theme}-{width}.png'))
            results.append({'theme':theme,'width':width,**metrics})
    # Explicit restore does not execute anything; reconnect preserves the saved note.
    page.locator(f'#room-content [data-archive-agent="{aid}"]').click()
    page.locator('#archive-form [value="restore"]').click()
    expect(page.locator('#modal-body [data-archive-agent]')).to_be_visible()
    page.locator('#modal-body [data-connect-agent]').click()
    expect(page.locator('#staff-entry')).to_be_visible()
    page.locator('#staff-submit').click()
    expect(page.locator('#modal-body [data-archive-agent]')).to_be_visible()
    page.keyboard.press('Escape')
    # Actual report clicks, separate answer drafts, approval and cancellation.
    tasks=[]
    for i in range(2):
        a=page.request.post(BASE+'/api/agents',data={'name':f'보고 검증 {i}','role':'검증','provider':'demo'}).json()
        tasks.append(page.request.post(BASE+'/api/tasks',data={'agentId':a['id'],'title':f'보고 {i}'}).json())
    page.goto(BASE+'/#tasks')
    page.locator(f'#task-list [data-task="{tasks[0]["id"]}"]').click()
    page.locator('#report-answer').fill('첫 업무 초안')
    page.locator(f'#room-content [data-workspace-task="{tasks[1]["id"]}"]').click()
    page.locator('#report-answer').fill('두 번째 업무 초안')
    page.locator(f'#room-content [data-workspace-task="{tasks[0]["id"]}"]').click()
    expect(page.locator('#report-answer')).to_have_value('첫 업무 초안')
    page.locator('#report-answer-submit').click()
    expect(page.locator('#report-approve')).to_be_visible()
    page.locator('#report-approve').click()
    expect(page.locator('#workbench-status')).to_contain_text('완료')
    page.locator(f'#room-content [data-workspace-task="{tasks[1]["id"]}"]').click()
    expect(page.locator('#report-answer')).to_have_value('두 번째 업무 초안')
    page.locator('#report-cancel').click()
    page.locator('[data-confirm-cancel]').click()
    expect(page.locator('#workbench-status')).to_contain_text('취소')
    assert not errors,errors
    print(json.dumps({'layouts':results,'flows':'store, drafts, restore, reconnect, answer, approve, cancel passed','errors':errors},ensure_ascii=False))
    browser.close()
