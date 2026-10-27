"""Run only against session-registration-preview.mjs (synthetic sessions)."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = f"http://127.0.0.1:{os.environ.get('SESSION_TEST_PORT', '18087')}"
OUT = Path('artifacts/session-registration')
OUT.mkdir(parents=True, exist_ok=True)
IDS = [f'00000000-{part}-4000-8000-000000000001' for part in ['1111', '2222', '3333', '4444', '5555']]


def management(page):
    panel = page.locator('.office-management')
    if not panel.evaluate('(e) => e.open'):
        panel.locator('summary').first.click()


def geometry(page, selector):
    result = page.locator(selector).evaluate('''root => {
      const visible = e => e.checkVisibility();
      const ids = [...root.querySelectorAll('.session-identity code')].filter(visible);
      const controls = [...root.querySelectorAll('button, input, select')].filter(visible);
      return {pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        ids: ids.map(e => ({full: e.textContent, font: parseFloat(getComputedStyle(e).fontSize),
          clipped: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1})),
        controls: controls.every(e => parseFloat(getComputedStyle(e).fontSize) >= 16 && e.getBoundingClientRect().height >= 44)};
    }''')
    assert not result['pageOverflow'] and result['controls'], result
    assert result['ids'] and all(i['font'] >= 14 and not i['clipped'] for i in result['ids']), result
    return result


def check(page, label, navigate=True):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    if navigate:
        page.goto(BASE + '/#agents')
    management(page)
    expect(page.locator('#agent-list .agent-card')).to_have_count(3)
    expect(page.locator('#session-list .unregistered-session')).to_have_count(2)
    assert set(page.locator('#agent-list .session-identity code').all_text_contents()) == set(IDS[:3])
    expect(page.locator('#session-list')).to_contain_text('현재 적재되지 않음')
    expect(page.locator('#session-list')).to_contain_text('세션 생존 확인 필요')
    geometry(page, '#agent-list')
    geometry(page, '#session-list')
    page.locator('#room-navigation [data-room="office"]').click()
    expect(page.locator('#room-content .session-identity code')).to_have_count(3)
    geometry(page, '#room-content')
    expect(page.locator('#desk-grid [data-person-id]')).to_have_count(3)
    page.wait_for_function('''() => {
      const boxes = [...document.querySelectorAll('#desk-grid .office-person')].filter(e => e.checkVisibility()).map(e => e.getBoundingClientRect());
      return boxes.length === 3 && !boxes.some((a, i) => boxes.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
    }''')

    # Same alias still leaves three independent full identities.
    first = page.request.get(BASE + '/api/state').json()['agents'][0]
    page.locator(f'#agent-list [data-edit-agent="{first["id"]}"]').click()
    expect(page.locator('#edit-name')).to_be_focused()
    expect(page.locator('#modal .session-identity code')).to_have_text(first['connection']['sessionId'])
    geometry(page, '#modal')
    page.locator('#edit-name').fill('설계 담당')
    page.locator('#edit-agent-form [type="submit"]').click()
    expect(page.locator('#modal-title')).to_have_text('설계 담당')
    page.keyboard.press('Escape')
    page.reload()
    management(page)
    expect(page.locator('#agent-list')).to_contain_text('설계 담당')
    page.locator(f'#agent-list [data-agent="{first["id"]}"]').click()
    expect(page.locator('#cli-dialog-state')).to_contain_text(first['connection']['sessionId'])
    expect(page.locator('#cli-dialog-state')).to_contain_text('설계 담당')
    geometry(page, '#cli-conversation-dialog')
    page.keyboard.press('Escape')

    # Manual registration removes exactly the selected pending session.
    page.locator(f'#session-list [data-connect-entry="cli:{IDS[3]}"]').click()
    expect(page.locator('#staff-source-identity code')).to_have_text(IDS[3])
    page.locator('#staff-employee').select_option(first['id'])
    expect(page.locator('#staff-employee-identity code')).to_have_text(first['connection']['sessionId'])
    page.locator('#staff-employee').select_option('')
    page.locator('#staff-name').fill('수동 별칭')
    page.locator('#staff-role').fill('등록 검증')
    geometry(page, '#staff-connection-dialog')
    page.locator('[data-staff-refresh]').click()
    expect(page.locator('#staff-name')).to_have_value('수동 별칭')
    expect(page.locator('#staff-source-identity code')).to_have_text(IDS[3])
    page.locator('#staff-submit').click()
    expect(page.locator('#modal-title')).to_have_text('수동 별칭')
    expect(page.locator('#agent-list .agent-card')).to_have_count(4)
    expect(page.locator('#session-list .unregistered-session')).to_have_count(1)
    page.locator('#modal [data-release-agent]').click()
    page.locator('#modal [data-confirm-release]').click()
    expect(page.locator('#agent-list .agent-card')).to_have_count(3)
    expect(page.locator('#session-list .unregistered-session')).to_have_count(2)
    page.keyboard.press('Escape')
    page.locator('#agent-list').scroll_into_view_if_needed()
    page.locator('#agent-list').screenshot(path=str(OUT / f'{label}-staff.png'))
    assert not errors, errors
    return {'label': label, 'geometry': geometry(page, '#agent-list')}


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    results = []
    for theme in ([] if os.environ.get('SESSION_TEST_ONLY_ZOOM') else ['light', 'dark']):
        for width in [320, 390, 768, 1366, 1920]:
            page = browser.new_page(viewport={'width': width, 'height': 1000}, color_scheme=theme, reduced_motion='reduce')
            results.append(check(page, f'{theme}-{width}'))
            page.close()
    browser.close()
    extension = Path('extensions/browser-observer').resolve()
    for theme in ['light', 'dark']:
        with tempfile.TemporaryDirectory() as profile:
            context = p.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
                viewport={'width': 1366, 'height': 1000}, color_scheme=theme, reduced_motion='reduce',
                args=['--no-sandbox', f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
            page = context.pages[0]
            page.goto(BASE + '/#agents')
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('''async () => { const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
              await chrome.tabs.setZoom(tab.id, 2); return chrome.tabs.getZoom(tab.id); }''') == 2
            results.append(check(page, f'{theme}-zoom200', navigate=False))
            context.close()
    (OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f'PASS: {len(results)} layouts, full identities, alias persistence, registration, release, drafts and real 200% zoom')
