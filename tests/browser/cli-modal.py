"""Run only against the synthetic layer-preview.mjs fixture, never live data."""
import base64
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
BASE = f"http://127.0.0.1:{os.environ.get('LAYER_TEST_PORT', '18084')}"
ARTIFACTS = ROOT / 'artifacts/cli-modal'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
results = []


def management(page):
    panel = page.locator('.office-management')
    if not panel.evaluate('(e)=>e.open'):
        panel.locator('summary').first.click()


def close(page):
    page.keyboard.press('Escape')
    expect(page.locator('dialog[open]')).to_have_count(0)


def check_modal(page, label):
    dialog = page.locator('#cli-conversation-dialog')
    expect(dialog).to_be_visible()
    expect(page.locator('#cli-dialog-log article').first).to_be_visible()
    metrics = dialog.evaluate('''d=>{
      const c=d.querySelector('[data-cli-close]'), r=c.getBoundingClientRect();
      const text=[...d.querySelectorAll('h2,p,label,input,select,button,summary,time,pre,a')].filter(e=>e.checkVisibility());
      return {width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth+1 || d.scrollWidth>d.clientWidth+1,
        close:r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-cli-close]')===c,
        minFont:Math.min(...text.map(e=>parseFloat(getComputedStyle(e).fontSize))),
        controls:[...d.querySelectorAll('input,select,button')].filter(e=>e.checkVisibility()).every(e=>parseFloat(getComputedStyle(e).fontSize)>=16 && e.getBoundingClientRect().height>=44)};
    }''')
    assert not metrics['overflow'] and metrics['close'] and metrics['controls'] and metrics['minFont'] >= 14, metrics
    assert page.locator('dialog[open]').count() == 1
    cdp = page.context.new_cdp_session(page)
    shot = cdp.send('Page.captureScreenshot', {'format':'png','fromSurface':False})
    (ARTIFACTS / f'{label}.png').write_bytes(base64.b64decode(shot['data']))
    cdp.detach()
    return metrics


def modal_case(page, label):
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/#office')
    page.locator('#room-navigation [data-room="warehouse"]').click()
    expect(page.locator('#room-heading')).to_have_text('창고')
    assert 'CLI 대화' not in page.locator('#workbench-detail').inner_text()
    entry = page.locator('#room-content [data-workspace-session]').first
    entry.scroll_into_view_if_needed()
    route = page.evaluate('location.hash')
    scroll = page.evaluate('scrollY')
    entry.focus(); page.keyboard.press('Enter')
    metrics = check_modal(page, label)
    assert page.evaluate('location.hash') == route
    assert abs(page.evaluate('scrollY') - scroll) <= 1
    expect(page.locator('#room-heading')).to_have_text('창고')
    assert 'CLI 대화' not in page.locator('#workbench-detail').inner_text()
    options = page.locator('.cli-dialog-options')
    if not options.evaluate('(e)=>e.open'): options.locator('summary').click()
    page.locator('#cli-dialog-query').fill('검증')
    page.locator('#cli-dialog-role').select_option('assistant')
    page.locator('#cli-dialog-log').evaluate('(e)=>e.scrollTop=420')
    close(page)
    assert page.evaluate('document.activeElement.hasAttribute("data-workspace-session")')
    entry.click()
    expect(page.locator('#cli-dialog-query')).to_have_value('검증')
    expect(page.locator('#cli-dialog-role')).to_have_value('assistant')
    assert abs(page.locator('#cli-dialog-log').evaluate('(e)=>e.scrollTop') - 420) <= 1
    close(page)
    assert not errors, errors
    results.append({'case':label, 'metrics':metrics, 'errors':errors})


def entry_flows(page):
    page.goto(BASE + '/#office')
    reads = []
    page.on('request', lambda r: reads.append(r.url) if '/conversation' in r.url else None)
    page.locator('#room-navigation [data-room="warehouse"]').click()
    expect(page.locator('#room-heading')).to_have_text('창고')
    page.wait_for_timeout(2800)
    assert not reads, 'Room entry must not start a background CLI reader'
    page.locator('#room-navigation [data-room="lounge"]').click()
    expect(page.locator('#room-heading')).to_have_text('휴게실')
    management(page)
    page.locator('#session-list [data-session]').first.click()
    expect(page.locator('#cli-dialog-log article').first).to_be_visible()
    expect(page.locator('#room-heading')).to_have_text('휴게실')
    close(page)
    count = len(reads)
    page.wait_for_timeout(5500)
    assert len(reads) == count, 'Closed dialog must not poll CLI records'
    page.locator('#agent-list [data-agent]').filter(has_text='검증 직원').first.click()
    expect(page.locator('#cli-dialog-log article').first).to_be_visible()
    page.locator('[data-cli-agent]').click()
    page.locator('#modal [data-session]').click()
    expect(page.locator('#cli-dialog-log article').first).to_be_visible()
    close(page)
    state = page.request.get(BASE + '/api/state').json()
    demo = next(a for a in state['agents'] if a['provider'] == 'demo')
    task = next((t for t in state['tasks'] if t['agentId'] == demo['id'] and t['status'] == 'waiting_input'), None)
    if task is None:
        response = page.request.post(BASE + '/api/tasks', data={'agentId':demo['id'], 'title':'CLI 모달 중 업무 초안 보존'})
        assert response.ok, response.status
        task = response.json()
    page.goto(BASE + '/#tasks')
    page.locator('#task-list [data-task="'+task['id']+'"]').click()
    expect(page.locator('#report-answer')).to_be_visible()
    page.locator('#report-answer').fill('모달 열람 뒤에도 남아야 하는 답변')
    room = page.locator('#room-heading').inner_text()
    management(page)
    page.locator('#session-list [data-session]').last.click()
    expect(page.locator('#cli-dialog-log article').first).to_be_visible()
    close(page)
    expect(page.locator('#report-answer')).to_have_value('모달 열람 뒤에도 남아야 하는 답변')
    expect(page.locator('#room-heading')).to_have_text(room)
    page.locator('#office-fullscreen').click()
    page.locator('#room-navigation [data-room="warehouse"]').click()
    expect(page.locator('#room-heading')).to_have_text('창고')
    page.locator('#room-content [data-workspace-session]').first.click()
    check_modal(page, 'fullscreen')
    close(page)
    results.append({'case':'entry paths, no background reads, report draft, fullscreen', 'passed':True})


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
    for theme in ['light','dark']:
        for width in [320,390,768,1366,1920]:
            page = browser.new_page(viewport={'width':width,'height':1000}, color_scheme=theme, reduced_motion='reduce')
            modal_case(page, f'{theme}-{width}')
            page.close()
    page = browser.new_page(viewport={'width':1366,'height':1000}, reduced_motion='reduce')
    entry_flows(page)
    browser.close()
    extension = ROOT / 'extensions/browser-observer'
    for theme in ['light','dark']:
        with tempfile.TemporaryDirectory(prefix='office-cli-zoom-') as profile:
            context = pw.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
                viewport={'width':1366,'height':1000}, color_scheme=theme, reduced_motion='reduce',
                args=['--no-sandbox',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
            page = context.pages[0]; page.goto(BASE)
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('''async()=>{const [t]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(t.id,2);return chrome.tabs.getZoom(t.id);}''') == 2
            modal_case(page, f'{theme}-zoom200')
            context.close()
(ARTIFACTS / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False), flush=True)
