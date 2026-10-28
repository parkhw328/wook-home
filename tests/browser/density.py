"""Run only with density-preview.mjs (isolated synthetic accounts and records)."""
import json
import os
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = f"http://127.0.0.1:{os.environ.get('DENSITY_TEST_PORT', '18089')}"
OUT = Path('artifacts/density'); OUT.mkdir(parents=True, exist_ok=True)
PASSWORD = 'Preview-only-password-2026'
VERSION = json.loads(Path('package.json').read_text())['version']
results = []


def audit(page, label):
    # Let hashchange navigation and its layout finish before measuring/capturing.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    data = page.evaluate('''() => {
      const visible = e => e.checkVisibility() && e.getBoundingClientRect().width > 0;
      const text = [...document.querySelectorAll('body *')].filter(visible).filter(e => [...e.childNodes].some(n=>n.nodeType===3 && n.textContent.trim()));
      const controls = [...document.querySelectorAll('button,input:not([type=checkbox]),select,textarea')].filter(visible).filter(e=>!e.closest('.office-scene'));
      const dialogs = [...document.querySelectorAll('dialog[open]')];
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
        small: text.filter(e=>parseFloat(getComputedStyle(e).fontSize)<14).map(e=>e.id||e.className),
        controls: controls.filter(e=>parseFloat(getComputedStyle(e).fontSize)<16 || e.getBoundingClientRect().height<43.9).map(e=>e.id||e.className),
        shadows: [...controls,...document.querySelectorAll('.panel,dialog[open]')].filter(visible).filter(e=>getComputedStyle(e).boxShadow!=='none').map(e=>e.id||e.className),
        dialogs: dialogs.length,
        badDialogs: dialogs.filter(d=>{const close=d.querySelector('[data-layer-close]'),r=close.getBoundingClientRect();return d.scrollWidth>d.clientWidth+1||r.top<0||r.bottom>innerHeight||r.right>innerWidth||document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-layer-close]')!==close;}).map(d=>d.id),
        headings: dialogs.filter(d=>parseFloat(getComputedStyle(d.querySelector('h2')).fontSize)<22).map(d=>d.id) };
    }''')
    assert not any(data[k] for k in ['overflow','small','controls','shadows','badDialogs','headings']) and data['dialogs'] <= 1, (label, data)
    results.append({'case': label, 'passed': True})


def login(page):
    page.goto(BASE)
    expect(page.locator('#login-form')).to_be_visible()
    page.locator('#password').fill(PASSWORD)
    page.locator('#login-form button').click()
    page.wait_for_url(BASE + '/')
    expect(page.locator('#app-version')).to_have_text('v' + VERSION)


def open_account(page):
    expect(page.locator('#account-menu-panel')).to_be_hidden()
    page.locator('#account-menu-button').click()
    expect(page.locator('#account-menu-button')).to_have_attribute('aria-expanded','true')
    expect(page.locator('#password-button')).to_be_visible()
    expect(page.locator('#logout-button')).to_be_visible()


def open_password(page):
    open_account(page)
    page.locator('#password-button').click()
    expect(page.locator('#account-menu-panel')).to_be_hidden()
    expect(page.locator('#password-dialog')).to_be_visible()


def check_sidebar(page, label):
    trigger=page.locator('#account-menu-button')
    panel=page.locator('#account-menu-panel')
    expect(panel).to_be_hidden()
    expect(trigger).to_have_attribute('aria-expanded','false')
    trigger.focus(); page.keyboard.press('Enter')
    expect(panel).to_be_visible()
    audit(page,label+'-account-menu'); capture(page,label,'account-menu')
    assert panel.evaluate('(e)=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}')
    page.keyboard.press('Tab'); expect(page.locator('#password-button')).to_be_focused()
    page.keyboard.press('Tab'); expect(page.locator('#logout-button')).to_be_focused()
    page.keyboard.press('Escape'); expect(panel).to_be_hidden(); expect(trigger).to_be_focused()
    page.keyboard.press('Space'); expect(panel).to_be_visible()
    page.locator('#page-title').click(); expect(panel).to_be_hidden()
    open_account(page)
    # The regular state refresh must not dismiss a focused account action.
    with page.expect_response(lambda response: response.url.endswith('/api/state') and response.status==200):
        page.locator('#password-button').focus()
    expect(panel).to_be_visible(); expect(page.locator('#password-button')).to_be_focused()
    page.keyboard.press('Tab'); page.keyboard.press('Tab')
    expect(page.locator('#brand-link')).to_be_focused(); expect(panel).to_be_hidden()
    open_account(page)
    page.evaluate("()=>location.hash='tasks'")
    expect(page.locator('#view-tasks')).to_be_visible(); expect(panel).to_be_hidden()
    page.locator('nav.main-nav a[href="#office"]').click()
    page.locator('#sidebar-programs').evaluate('(e)=>e.open=true')
    blog=page.locator('.blog-card h3')
    expect(blog).to_have_text('StackQueue Blog')
    assert blog.evaluate('(e)=>{const r=document.createRange();r.selectNodeContents(e);return r.getClientRects().length===1&&e.scrollWidth<=e.clientWidth&&parseFloat(getComputedStyle(e).fontSize)>=18}')
    expect(page.locator('.sidebar .help-link, .sidebar .footer-help')).to_have_count(0)
    help_link=page.locator('.sidebar-footer a').first
    version_link=page.locator('#version-link')
    expect(help_link).to_have_text('도움말 ↗')
    expect(page.locator('#app-version')).to_have_text('v'+VERSION)
    targets=[(help_link,'https://github.com/parkhw328/wook-home/wiki/UI'),
             (version_link,f'https://github.com/parkhw328/wook-home/blob/v{VERSION}/CHANGELOG.md')]
    # Inspect the navigation target without fetching external content.
    handler=lambda route:route.fulfill(status=200,content_type='text/html',body='<title>Link target</title>')
    page.context.route('https://github.com/**',handler)
    for link,url in targets:
        expect(link).to_have_attribute('href',url)
        expect(link).to_have_attribute('rel','noopener noreferrer')
        assert link.evaluate('(e)=>e.getBoundingClientRect().height>=44')
        with page.expect_popup() as popup:
            link.click()
        target=popup.value; target.wait_for_url(url); target.close()
    page.context.unroute('https://github.com/**',handler)


def close(page):
    if page.locator('[role=tooltip]:visible').count():
        page.keyboard.press('Escape')
    page.keyboard.press('Escape')
    expect(page.locator('dialog[open]')).to_have_count(0)


def capture(page, label, name):
    if label in ['light-1366','dark-1366','light-320','dark-320']:
        page.screenshot(path=str(OUT / f'{label}-{name}.png'), full_page=not page.locator('dialog[open]').count())


def check(page, label):
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    audit(page, label + '-login')
    capture(page, label, 'login')
    login(page)
    audit(page, label + '-office')
    capture(page, label, 'office')
    assert page.locator('#motion-toggle').evaluate("e=>!!e.closest('.scene-header')")
    assert page.locator('#room-navigation').inner_text().strip().splitlines()[0].endswith('F')
    button = page.locator('#room-navigation [data-room="office"]')
    button.hover()
    tip = page.locator('#room-navigation-tooltip')
    expect(tip).to_be_visible()
    expect(tip).to_contain_text('고객 포털과 주문 관리 통합 프로젝트 · 사무실')
    assert tip.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}')
    page.keyboard.press('Escape'); expect(tip).to_be_hidden()
    expect(page.locator('#room-heading')).to_have_text('사무실')
    button.focus(); page.keyboard.press('ArrowRight')
    expect(tip).to_be_visible(); expect(tip).to_contain_text('회의실')
    page.keyboard.press('Escape')
    page.locator('#room-navigation [data-floor="0"]').click()
    page.locator('#room-navigation [data-room="office"]').click()
    expect(page.locator('#floor-view-title')).to_contain_text('고객 포털')
    page.locator('#office-fullscreen').click()
    expect(page.locator('#office-fullscreen')).to_have_attribute('aria-pressed','true')
    audit(page,label+'-fullscreen')
    page.locator('#room-navigation [data-room="meeting"]').hover()
    expect(tip).to_be_visible()
    page.locator('#office-fullscreen').click()
    expect(page.locator('#office-fullscreen')).to_have_attribute('aria-pressed','false')

    check_sidebar(page,label)
    open_password(page)
    audit(page,label+'-password-dialog'); capture(page,label,'password')
    page.locator('#account-password-form [name="currentPassword"]').fill('synthetic input')
    close(page)
    expect(page.locator('#account-menu-button')).to_be_focused()
    open_password(page)
    expect(page.locator('#account-password-form [name="currentPassword"]')).to_have_value('')
    page.mouse.click(2,2); expect(page.locator('#password-dialog')).not_to_be_visible()

    page.locator('#hire-button').click()
    page.locator('#agent-name').fill('유지할 채용 초안')
    audit(page,label+'-hire'); close(page)
    page.locator('#hire-button').click()
    expect(page.locator('#agent-name')).to_have_value('유지할 채용 초안'); close(page)
    page.locator('[data-office-stat="agents"]').click()
    audit(page,label+'-stats'); close(page)

    page.locator('.office-management').evaluate('(e)=>e.open=true')
    page.locator('#agent-list [data-agent]').filter(has_text='검증 직원').first.click()
    page.locator('#cli-dialog-log article').first.wait_for()
    page.locator('.cli-dialog-options').evaluate('(e)=>e.open=true')
    page.locator('#cli-dialog-query').fill('검증')
    page.locator('#cli-dialog-role').select_option('assistant')
    audit(page,label+'-cli'); capture(page,label,'cli')
    close(page)
    page.locator('#agent-list [data-agent]').filter(has_text='검증 직원').first.click()
    expect(page.locator('#cli-dialog-query')).to_have_value('검증')
    page.locator('[data-cli-agent]').click()
    audit(page,label+'-staff-command')
    page.locator('#session-command').fill('보존할 지시 초안')
    page.locator('#modal [data-edit-agent]').click()
    audit(page,label+'-staff-settings'); close(page)
    page.locator('#agent-list [data-agent]').filter(has_text='연결 전 직원').first.click()
    page.locator('#modal [data-connect-agent]').click()
    page.locator('#staff-entry').wait_for()
    audit(page,label+'-staff-connection'); close(page)

    page.locator('#room-navigation [data-room="warehouse"]').click()
    page.locator('#room-content [data-archive-agent]').first.click()
    audit(page,label+'-waiting-edit'); close(page)
    page.locator('#room-navigation [data-room="pantry"]').click()
    page.locator('[data-history-status]').filter(has_text='건').wait_for()
    audit(page,label+'-history')

    page.locator('nav.main-nav a[href="#tasks"]').click()
    audit(page,label+'-tasks'); capture(page,label,'tasks')
    page.locator('#new-task-button').click()
    audit(page,label+'-new-task'); close(page)
    page.locator('#task-list [data-task]').first.click()
    expect(page.locator('#workbench-detail')).to_be_visible()
    audit(page,label+'-report')
    page.locator('#report-answer').fill('답변 초안 유지')
    page.locator('#workbench-close').click(); page.locator('#workbench-reopen').click()
    expect(page.locator('#report-answer')).to_have_value('답변 초안 유지')
    page.locator('nav.main-nav a[href="#search"]').click()
    expect(page.locator('[data-search-session]').first).to_be_visible()
    audit(page,label+'-search'); capture(page,label,'search')
    page.locator('[data-search-session]').first.click()
    page.locator('.search-message').first.wait_for()
    audit(page,label+'-saved-conversation'); close(page)
    page.locator('.search-settings summary').click()
    audit(page,label+'-search-import')
    page.locator('nav.main-nav a[href="#handoff"]').click()
    audit(page,label+'-handoff'); capture(page,label,'handoff')
    page.locator('nav.main-nav a[href="#connection-settings"]').click()
    page.locator('#connection-settings-title').wait_for()
    audit(page,label+'-connection-settings'); capture(page,label,'connection-settings')
    page.locator('.bridge-start-guide summary').click()
    audit(page,label+'-connection-guide')
    for tab in ['detected','checks']:
        page.locator('#discovery-tab-'+tab).click()
        audit(page,label+'-connection-'+tab)
    assert not errors, errors
    print(label + ': passed', flush=True)


def password_flow(browser):
    page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
    login(page)
    other=browser.new_context(); other_page=other.new_page(); login(other_page)
    open_password(page)
    form=page.locator('#account-password-form')
    form.locator('[name=currentPassword]').fill(PASSWORD)
    form.locator('[name=newPassword]').fill('1234567')
    form.locator('[name=confirmPassword]').fill('1234567')
    assert not form.evaluate('(e)=>e.checkValidity()')
    form.locator('[name=newPassword]').fill('Test-8ch')
    form.locator('[name=confirmPassword]').fill('Mismatch')
    form.locator('[type=submit]').click()
    expect(page.locator('#password-dialog-feedback')).to_contain_text('일치하지')
    form.locator('[name=confirmPassword]').fill('Test-8ch')
    form.locator('[name=currentPassword]').fill('wrong-current')
    form.locator('[type=submit]').click()
    expect(page.locator('#password-dialog-feedback')).to_contain_text('확인해')
    form.locator('[name=currentPassword]').fill(PASSWORD)
    form.locator('[type=submit]').click()
    expect(page.locator('#password-dialog-feedback')).to_contain_text('변경했습니다')
    assert page.request.get(BASE+'/api/state').status == 200
    assert other.request.get(BASE+'/api/state').status == 401
    expect(form.locator('[name=newPassword]')).to_have_value('')
    close(page)
    open_account(page)
    page.locator('#logout-button').click()
    expect(page.locator('#login-form')).to_be_visible()
    page.locator('#password').fill(PASSWORD); page.locator('#login-form button').click()
    expect(page.locator('#login-feedback')).to_contain_text('확인해')
    page.locator('#password').fill('Test-8ch'); page.locator('#login-form button').click()
    page.wait_for_url(BASE+'/')
    open_password(page)
    held=[]; page.route('**/api/auth/password', lambda route: held.append(route))
    form.locator('[name=currentPassword]').fill('Test-8ch')
    form.locator('[name=newPassword]').fill(PASSWORD)
    form.locator('[name=confirmPassword]').fill(PASSWORD)
    form.locator('[type=submit]').click()
    close(page)
    response=held[0].fetch(); held[0].fulfill(response=response)
    expect(page.locator('#toast')).to_contain_text('변경했습니다')
    expect(page.locator('dialog[open]')).to_have_count(0)
    other.close(); page.close()
    results.append({'case':'password 7/8 boundary, mismatch, wrong current, session invalidation, re-login, late save','passed':True})


with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
    for theme in ['light','dark']:
        for width in ([1366] if '--quick' in sys.argv else [320] if '--mobile' in sys.argv else [320,390,768,1366,1920]):
            page=browser.new_page(viewport={'width':width,'height':900},color_scheme=theme,reduced_motion='reduce')
            check(page,f'{theme}-{width}'); page.close()
    password_flow(browser)
    # Touch navigation reveals the name while still entering the room on one tap.
    page=browser.new_page(viewport={'width':390,'height':844},has_touch=True,is_mobile=True,reduced_motion='reduce')
    login(page)
    page.locator('#account-menu-button').tap()
    expect(page.locator('#account-menu-panel')).to_be_visible()
    page.locator('#password-button').tap()
    expect(page.locator('#password-dialog')).to_be_visible()
    close(page); expect(page.locator('#account-menu-button')).to_be_focused()
    page.locator('#room-navigation [data-room="office"]').tap()
    expect(page.locator('#room-navigation-tooltip')).to_contain_text('고객 포털')
    audit(page,'touch-tooltip')
    page.locator('#room-navigation [data-room="meeting"]').tap()
    expect(page.locator('#room-heading')).to_have_text('회의실')
    expect(page.locator('#room-navigation-tooltip')).to_be_visible()
    page.close(); browser.close()
    extension=Path('extensions/browser-observer').resolve()
    for theme in ([] if any(arg in sys.argv for arg in ['--quick','--mobile']) else ['light','dark']):
        with tempfile.TemporaryDirectory() as profile:
            context=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,viewport={'width':1366,'height':1000},color_scheme=theme,reduced_motion='reduce',
                args=['--no-sandbox','--enable-unsafe-swiftshader',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
            page=context.pages[0]; page.goto(BASE)
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('''async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(tab.id,2);return chrome.tabs.getZoom(tab.id);}''')==2
            check(page,f'{theme}-zoom200'); context.close()
OUT.joinpath('results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(f'PASS: {len(results)} screen/interaction audits',flush=True)
