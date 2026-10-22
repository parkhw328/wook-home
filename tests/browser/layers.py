"""Optional real-browser regression suite; run only against layer-preview.mjs."""
import json
import base64
import os
import sys
import tempfile
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PORT = int(os.environ.get('LAYER_TEST_PORT', '18084'))
BASE = f'http://127.0.0.1:{PORT}'
REMOTE = f'http://office.test:{PORT}'
ARTIFACTS = ROOT / 'artifacts/layer-audit'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
results = []


def open_cli(page):
    page.goto(BASE + '/#agents')
    page.locator('[data-agent]').filter(has_text='검증 직원').first.click()
    page.locator('#cli-dialog-log article').first.wait_for()


def geometry(page, selector):
    data = page.locator(selector).evaluate('''d => {
      const close = d.querySelector('[data-layer-close]'), r = close.getBoundingClientRect();
      const text = [...d.querySelectorAll('h2, p, label, input, select, textarea, button, summary, time, small, pre, a')].filter(e => e.checkVisibility());
      return { width: innerWidth, height: innerHeight, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        overflow: d.scrollWidth > d.clientWidth + 1, closeVisible: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        closeUsable: document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-layer-close]') === close,
        closeHeight: r.height, minFont: Math.min(...text.map(e=>parseFloat(getComputedStyle(e).fontSize))),
        controls: [...d.querySelectorAll('button, input, select, textarea')].filter(e=>e.checkVisibility()).every(e=>parseFloat(getComputedStyle(e).fontSize)>=16 && e.getBoundingClientRect().height>=44),
        heading: parseFloat(getComputedStyle(d.querySelector('h2')).fontSize) };
    }''')
    assert not data['pageOverflow'] and not data['overflow'], data
    assert data['closeVisible'] and data['closeUsable'] and data['closeHeight'] >= 44, data
    assert data['minFont'] >= 14 and data['controls'] and data['heading'] >= 22, data
    assert page.locator('dialog[open]').count() == 1
    return data


def screenshot(page, name):
    # Native browser zoom changes device pixels; Playwright's default CSS clip
    # can capture the wrong page rectangle. Capture the actual viewport instead.
    session = page.context.new_cdp_session(page)
    try:
        capture = session.send('Page.captureScreenshot', {'format':'png','fromSurface':False})
        (ARTIFACTS / name).write_bytes(base64.b64decode(capture['data']))
    finally:
        session.detach()


def matrix_case(page, label):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    open_cli(page)
    if not page.locator('.cli-dialog-options').evaluate('(e)=>e.open'):
        page.locator('.cli-dialog-options summary').click()
    page.locator('#cli-dialog-query').fill('검증')
    page.locator('#cli-dialog-role').select_option('assistant')
    page.locator('#cli-dialog-log').evaluate('(e)=>e.scrollTop=1234')
    page.locator('#cli-conversation-dialog .dialog-layer-body').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    cli = geometry(page, '#cli-conversation-dialog')
    screenshot(page, f'{label}-cli.png')
    page.locator('[data-cli-close]').click()
    assert page.locator('dialog[open]').count() == 0
    page.locator('[data-agent]').filter(has_text='검증 직원').first.click()
    expect(page.locator('#cli-dialog-query')).to_have_value('검증')
    expect(page.locator('#cli-dialog-role')).to_have_value('assistant')
    assert abs(page.locator('#cli-dialog-log').evaluate('(e)=>e.scrollTop') - 1234) < 2
    page.locator('[data-cli-agent]').click()
    page.locator('#session-command').fill('작성 중인 지시 유지\n테마와 창을 바꿔도 보존')
    page.locator('#command-model').select_option('fixture-model')
    page.locator('#command-effort').select_option('high')
    page.locator('#session-command').scroll_into_view_if_needed()
    main = geometry(page, '#modal')
    screenshot(page, f'{label}-command.png')
    page.keyboard.press('Escape')
    page.locator('[data-agent]').filter(has_text='검증 직원').first.click()
    page.locator('[data-cli-agent]').click()
    expect(page.locator('#session-command')).to_have_value('작성 중인 지시 유지\n테마와 창을 바꿔도 보존')
    expect(page.locator('#command-effort')).to_have_value('high')
    page.locator('#modal [data-open-connection-settings]').click()
    expect(page.locator('dialog[open]')).to_have_count(0)
    page.goto(BASE + '/#agents')
    page.locator('[data-agent]').filter(has_text='연결 전 직원').first.click()
    if page.locator('#cli-conversation-dialog').is_visible(): page.locator('[data-cli-agent]').click()
    page.locator('[data-connect-agent]').click()
    page.locator('#staff-entry').wait_for()
    staff = geometry(page, '#staff-connection-dialog')
    page.locator('[data-staff-close]').click()
    expect(page.locator('dialog[open]')).to_have_count(0)
    page.goto(BASE + '/#search')
    page.locator('[data-search-session]').first.click()
    page.locator('.search-message').first.wait_for()
    page.locator('#search-dialog .dialog-layer-body').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    search = geometry(page, '#search-dialog')
    screenshot(page, f'{label}-search.png')
    page.mouse.click(2, 2)
    expect(page.locator('dialog[open]')).to_have_count(0)
    assert page.evaluate('document.activeElement.hasAttribute("data-search-session")')
    assert not errors, errors
    result = {'case': label, 'cli': cli, 'command': main, 'staff': staff, 'search': search, 'pageErrors': errors}
    results.append(result)
    print(label + ': passed', flush=True)


def http_import(browser, storage_blocked=False):
    page = browser.new_page(viewport={'width':390,'height':844}, reduced_motion='reduce')
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    if storage_blocked:
        page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}})")
    page.goto(REMOTE + '/#search')
    capability = page.evaluate('({secure:isSecureContext,uuid:typeof crypto.randomUUID,subtle:typeof crypto.subtle})')
    assert capability == {'secure':False, 'uuid':'undefined', 'subtle':'undefined'}, capability
    page.locator('.search-settings summary').click()
    form = page.locator('#search-import-form')
    form.locator('[name=url]').fill('https://claude.ai/')
    content = f'HTTP 직접 보관 {storage_blocked} {uuid.uuid4()} <script>text only</script> 한글 검증'
    form.locator('[name=content]').fill(content)
    form.locator('button').click()
    expect(page.locator('#search-import-status')).to_contain_text('개별 대화 주소')
    expect(form.locator('[name=content]')).to_have_value(content)
    form.locator('[name=url]').fill('https://claude.ai/chat/10000000-0000-4000-8000-000000000003')
    for _ in range(2):
        form.locator('[name=content]').fill(content); form.locator('button').click()
        expect(page.locator('#search-import-status')).to_contain_text('보관했습니다')
    page.locator('#session-search-query').fill(content)
    page.locator('#session-search-form button[type=submit]').click()
    expect(page.locator('[data-search-session]')).to_have_count(1)
    page.locator('[data-search-session]').click()
    expect(page.locator('.search-message')).to_contain_text('<script>text only</script>')
    assert page.locator('.search-message script').count() == 0
    page.locator('#search-dialog-close').click()
    assert not errors, errors
    results.append({'case':'HTTP import', 'storageBlocked':storage_blocked, **capability, 'pageErrors':errors})
    page.close()


def transitions(browser):
    page = browser.new_page(viewport={'width':1366,'height':900}, reduced_motion='reduce')
    page.goto(BASE + '/#office')
    page.locator('#office-fullscreen').click()
    expect(page.locator('#office-fullscreen')).to_have_attribute('aria-pressed','true')
    page.locator('#office-workspace [data-agent]').filter(has_text='검증 직원').first.click()
    page.locator('#cli-dialog-log article').first.wait_for()
    geometry(page, '#cli-conversation-dialog')
    page.keyboard.press('Escape')
    expect(page.locator('dialog[open]')).to_have_count(0)
    # A second Escape may also be consumed by the browser's native fullscreen UI.
    if page.locator('#office-fullscreen').get_attribute('aria-pressed') == 'true': page.locator('#office-fullscreen').click()
    page.locator('#room-navigation [data-room=office]').click()
    page.locator('#workbench-detail').wait_for()
    page.locator('#terminal-search').fill('검증')
    page.locator('#workbench-close').click()
    expect(page.locator('#workbench-detail')).to_be_hidden()
    page.wait_for_timeout(2700)
    expect(page.locator('#workbench-detail')).to_be_hidden()
    page.locator('#workbench-reopen').click()
    expect(page.locator('#terminal-search')).to_have_value('검증')
    # Closing an in-flight save must not make the late response reopen a modal.
    held = []
    page.route('**/api/agents', lambda route: held.append(route) if route.request.method == 'POST' else route.continue_())
    page.locator('#hire-button').click()
    page.locator('#agent-name').fill('저장 대기 검증'); page.locator('#agent-role').fill('종료 후 결과 검증')
    page.locator('#hire-form button[type=submit]').click()
    expect(page.locator('#modal-pending')).to_be_visible()
    page.locator('#close-modal').click()
    response = held[0].fetch(); held[0].fulfill(response=response)
    expect(page.locator('#toast')).to_contain_text('새 동료')
    expect(page.locator('dialog[open]')).to_have_count(0)
    page.close()
    results.append({'case':'fullscreen, inline close, in-flight save', 'passed':True})


def late_responses(browser):
    page = browser.new_page(viewport={'width':1366,'height':900}, reduced_motion='reduce')
    def hire(name):
        response = page.request.post(BASE+'/api/agents', data={'name':name,'role':'지연 응답 검증','provider':'demo'})
        assert response.ok
        return response.json()
    first, second = hire('초안 직원 A'), hire('초안 직원 B')
    page.goto(BASE+'/#agents')
    def task_form(agent):
        page.locator('.office-management').evaluate('(e)=>e.open=true')
        page.locator(f'#agent-list [data-agent="{agent["id"]}"]').click()
        page.locator('[data-new-task]').click()
    task_form(first)
    page.locator('#task-title').fill('A 직원에게만 전달할 초안')
    page.locator('#close-modal').click()
    task_form(second)
    expect(page.locator('#task-agent')).to_have_value(second['id'])
    expect(page.locator('#task-title')).to_have_value('')
    page.locator('#task-title').fill('B 직원의 별도 초안')
    page.locator('#close-modal').click()
    task_form(first)
    expect(page.locator('#task-agent')).to_have_value(first['id'])
    expect(page.locator('#task-title')).to_have_value('A 직원에게만 전달할 초안')
    page.locator('#close-modal').click()
    # Two delayed answers: dismissing the panel and selecting another report.
    tasks = []
    for agent in [first, second]:
        response = page.request.post(BASE+'/api/tasks',data={'agentId':agent['id'],'title':agent['name']+' 보고'})
        assert response.ok; tasks.append(response.json())
    for index in range(2):
        page.goto(BASE+'/#tasks')
        page.locator(f'#task-list [data-task="{tasks[index]["id"]}"]').click()
        page.locator('#report-answer').fill('지연 검증 답변')
        held = []
        pattern = '**/api/tasks/'+tasks[index]['id']+'/messages'
        page.route(pattern, lambda route: held.append(route))
        page.locator('#report-answer-submit').click()
        if index == 0:
            page.locator('#workbench-close').click()
        else:
            page.locator(f'[data-workspace-task="{tasks[0]["id"]}"]').click()
        response = held[0].fetch(); held[0].fulfill(response=response)
        expect(page.locator('#toast')).to_contain_text('답변을 전달')
        if index == 0: expect(page.locator('#workbench-detail')).to_be_hidden()
        else: expect(page.locator('#workbench-title')).to_have_text(tasks[0]['title'])
        page.unroute(pattern)
    # Successful staff connection followed by a delayed state refresh.
    page.goto(BASE+'/#agents')
    page.locator('.office-management').evaluate('(e)=>e.open=true')
    page.locator('#agent-list [data-agent]').filter(has_text='연결 전 직원').click()
    if page.locator('#cli-conversation-dialog').is_visible(): page.locator('[data-cli-agent]').click()
    page.locator('[data-connect-agent]').click()
    page.locator('#staff-entry').wait_for()
    held = []
    page.route('**/api/state', lambda route: held.append(route) if not held else route.continue_())
    page.locator('#staff-submit').click()
    expect(page.locator('#staff-connection-dialog')).not_to_be_visible()
    page.evaluate("location.hash='search'")
    page.wait_for_timeout(200)
    assert held, 'state refresh must be held before navigating away'
    response = held[0].fetch(); held[0].fulfill(response=response)
    page.unroute('**/api/state')
    expect(page.locator('#toast')).to_contain_text('직원 연결')
    expect(page.locator('dialog[open]')).to_have_count(0)
    assert page.evaluate('location.hash') == '#search'
    page.close()
    results.append({'case':'late report close/selection, staff route change, per-employee drafts','passed':True})
    print('Late responses and per-employee drafts: passed', flush=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP office.test 127.0.0.1'])
    for theme in ([] if any(arg in sys.argv for arg in ['--zoom-only','--flows-only','--late-only']) else ['light','dark']):
        for width in [320,390,768,1366,1920]:
            page = browser.new_page(viewport={'width':width,'height':900}, color_scheme=theme, reduced_motion='reduce')
            matrix_case(page, f'{theme}-{width}'); page.close()
    if '--late-only' in sys.argv:
        late_responses(browser)
    elif '--zoom-only' not in sys.argv:
        http_import(browser); http_import(browser, True); transitions(browser); late_responses(browser)
    browser.close()
    extension = ROOT / 'extensions/browser-observer'
    for theme in ([] if any(arg in sys.argv for arg in ['--flows-only','--late-only']) else ['light','dark']):
        with tempfile.TemporaryDirectory(prefix='office-layer-zoom-') as profile:
            context = playwright.chromium.launch_persistent_context(profile, channel='chromium', headless=not bool(os.environ.get('DISPLAY')),
                viewport={'width':1366,'height':1000}, color_scheme=theme, reduced_motion='reduce',
                args=['--no-sandbox','--disable-gpu',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
            page = context.pages[0]; page.goto(BASE)
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            zoom = worker.evaluate('''async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(tab.id,2);return chrome.tabs.getZoom(tab.id);}''')
            assert zoom == 2
            matrix_case(page, f'{theme}-zoom200'); context.close()
(ARTIFACTS / ('zoom-results.json' if '--zoom-only' in sys.argv else 'late-results.json' if '--late-only' in sys.argv else 'flows-results.json' if '--flows-only' in sys.argv else 'results.json')).write_text(json.dumps(results, ensure_ascii=False, indent=2))
print('All layer and HTTP import checks passed.', flush=True)
