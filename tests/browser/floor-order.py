"""Run with the synthetic layer-preview server on port 18086."""
import os, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE = f"http://127.0.0.1:{os.environ.get('LAYER_TEST_PORT', '18086')}"
OUT = Path('artifacts/floor-order')
OUT.mkdir(parents=True, exist_ok=True)
def check(page, label):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    expect(page.locator('.floor-directory')).to_have_count(0)
    buttons = page.locator('#room-navigation button')
    expect(buttons).to_have_count(7)
    assert buttons.evaluate_all('(es)=>es.map(e=>e.dataset.room || e.dataset.floor)') == ['executive','office','meeting','lounge','warehouse','pantry','0']
    assert all(h >= 44 for h in buttons.evaluate_all('(es)=>es.map(e=>e.getBoundingClientRect().height)'))
    overview = page.locator('#room-navigation [data-floor="0"]')
    for room, title in [('executive','대표이사실'),('office','사무실'),('warehouse','창고')]:
        button = page.locator(f'#room-navigation [data-room="{room}"]')
        button.click()
        expect(page.locator('#room-heading')).to_have_text(title)
        overview.click()
        expect(overview).to_have_attribute('aria-pressed','true')
        expect(page.locator('#floor-view-title')).to_have_text('세 개의 층, 하나의 팀')
        button.click()
        expect(overview).to_have_attribute('aria-pressed','false')
    buttons.first.focus()
    page.keyboard.press('End')
    expect(overview).to_be_focused()
    page.keyboard.press('Enter')
    expect(overview).to_have_attribute('aria-pressed','true')
    page.locator('#room-navigation [data-room="office"]').click()
    expect(page.locator('#room-content [data-workspace-session]')).to_have_count(0)
    expect(page.locator('#room-content')).not_to_contain_text('검증 직원')
    page.locator('#room-navigation [data-room="warehouse"]').click()
    expect(page.locator('#room-content')).to_contain_text('턴 종료 관찰')
    expect(page.locator('#room-content')).to_contain_text('검증 직원')
    page.locator('#room-content [data-workspace-session]').first.click()
    expect(page.locator('#cli-conversation-dialog')).to_be_visible()
    page.keyboard.press('Escape')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.locator('#room-navigation').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT / f'{label}.png'))
    assert not errors, errors
with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox'])
    for theme in ['light', 'dark']:
        for width in [320,390,768,1366,1920]:
            page = browser.new_page(viewport={'width':width,'height':1000},color_scheme=theme,reduced_motion='reduce')
            check(page, f'{theme}-{width}')
            page.close()
    browser.close()
    ext = Path('extensions/browser-observer').resolve()
    for theme in ['light','dark']:
        with tempfile.TemporaryDirectory() as profile:
            context = p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,viewport={'width':1366,'height':1000},color_scheme=theme,reduced_motion='reduce',args=['--no-sandbox',f'--disable-extensions-except={ext}',f'--load-extension={ext}'])
            page = context.pages[0]
            page.goto(BASE)
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('''async()=>{const [t]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(t.id,2);return chrome.tabs.getZoom(t.id)}''') == 2
            check(page, f'{theme}-zoom200')
            context.close()
print('PASS: floor order, warehouse sessions, dialogue access, both themes, five widths and actual 200% zoom')
