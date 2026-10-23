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
    buttons = page.locator('#floor-navigation [data-floor]')
    expect(buttons).to_have_count(4)
    assert buttons.evaluate_all('(es)=>es.map(e=>e.dataset.floor)') == ['3','2','1','0']
    rects = buttons.evaluate_all('(es)=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,h:r.height}})')
    assert len({r['x'] for r in rects}) == 1, rects
    assert all(rects[i]['y'] < rects[i+1]['y'] for i in range(3)), rects
    assert all(r['h'] >= 44 for r in rects), rects
    for floor in ['3','2','1']:
        button = page.locator(f'#floor-navigation [data-floor="{floor}"]')
        button.click()
        expect(button).to_have_attribute('aria-pressed', 'true')
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
    page.locator('.floor-directory').scroll_into_view_if_needed()
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
