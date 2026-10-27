"""Tooltip interactions against session-registration-preview.mjs only."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = f"http://127.0.0.1:{os.environ.get('SESSION_TEST_PORT', '18087')}"
OUT = Path('artifacts/session-registration')
OUT.mkdir(parents=True, exist_ok=True)
ID = '00000000-1111-4000-8000-000000000001'


def check_tip(page, expected):
    tip = page.locator('#session-identity-tooltip')
    expect(tip).to_be_visible()
    expect(tip.locator('code')).to_have_text(expected)
    assert tip.evaluate('e => e.matches(":popover-open")')
    box = tip.bounding_box()
    viewport = page.evaluate('({width: innerWidth, height: innerHeight})')
    assert 0 <= box['x'] and box['x'] + box['width'] <= viewport['width'] + 1
    assert 0 <= box['y'] and box['y'] + box['height'] <= viewport['height'] + 1
    return tip


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    errors = []
    for theme in ['light', 'dark']:
        page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True,
                                has_touch=True, color_scheme=theme, reduced_motion='reduce')
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/#agents')
        page.locator('.office-management > summary').tap()
        page.locator(f'#agent-list .agent-card:has([data-session-identity="{ID}"])').tap()
        button = page.locator('#cli-dialog-state .session-identity')
        expect(button).to_be_visible()
        button.tap()
        tip = check_tip(page, ID)
        page.screenshot(path=str(OUT / f'{theme}-touch-id.png'))
        # Polling must preserve the selected ID and open disclosure.
        page.wait_for_timeout(5500)
        check_tip(page, ID)
        button.tap()
        expect(tip).to_be_hidden()
        button.tap()
        check_tip(page, ID)
        page.locator('#cli-dialog-title').tap()
        expect(tip).to_be_hidden()
        expect(page.locator('#cli-conversation-dialog')).to_be_visible()
        # Selecting a different session discards the old identity.
        page.locator('.cli-dialog-options > summary').tap()
        page.locator('#cli-dialog-session').select_option('00000000-2222-4000-8000-000000000001')
        button.tap()
        check_tip(page, '00000000-2222-4000-8000-000000000001')
        page.locator('[data-cli-close]').tap()
        expect(tip).to_be_hidden()
        page.close()

    page = browser.new_page(viewport={'width': 1366, 'height': 1000}, reduced_motion='reduce')
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/#agents')
    expect(page.locator('#desk-grid .office-person')).to_have_count(3)
    page.locator('#office-fullscreen').click()
    page.wait_for_function('document.fullscreenElement !== null')
    person = page.locator(f'#desk-grid .office-person:has([data-session-identity="{ID}"])')
    person.hover()
    tip = check_tip(page, ID)
    tip.hover()
    page.wait_for_timeout(200)
    check_tip(page, ID)
    page.screenshot(path=str(OUT / 'fullscreen-hover-id.png'))
    page.keyboard.press('Escape')
    expect(tip).to_be_hidden()
    assert page.evaluate('document.fullscreenElement !== null')
    page.locator('#office-fullscreen').click()
    page.locator('.office-management > summary').click()
    # Full IDs are not duplicated in discovery headings.
    marker = page.locator(f'#discovery-list [data-session-identity="{ID}"]')
    page.keyboard.press('Tab')
    marker.focus()
    check_tip(page, ID)
    page.wait_for_timeout(5500)
    expect(marker).to_be_focused()
    check_tip(page, ID)
    assert ID not in page.locator('#discovery-list').inner_text()
    page.keyboard.press('Escape')
    page.locator('[data-office-stat="agents"]').click()
    entry = page.locator(f'#stat-detail-list button:has([data-session-identity="{ID}"])')
    page.keyboard.press('Tab')
    entry.focus()
    check_tip(page, ID)
    page.keyboard.press('Escape')
    expect(page.locator('#modal')).to_be_visible()
    page.keyboard.press('Escape')

    # Search display names carry the provider and full origin ID in the API.
    session = {'id': 'synthetic-search', 'name': f'Codex · {ID}', 'provider': 'openai', 'source': 'cli', 'state': 'stored'}
    message = {'key': 'synthetic-message', 'role': 'assistant', 'content': '합성 검색 검증', 'snippet': '합성 검색 검증'}
    page.route('**/api/search/query', lambda route: route.fulfill(json={
        'total': 1, 'limit': 30, 'query': '', 'results': [{**message, 'session': session}]}))
    page.route('**/api/search/sessions/synthetic-search', lambda route: route.fulfill(json={
        'session': session, 'messages': [message]}))
    page.goto(BASE + '/#search')
    result = page.locator('.search-result-open')
    expect(result).to_have_text('Codex ID ↗')
    result.hover()
    check_tip(page, ID)
    result.click()
    expect(page.locator('#search-dialog-title')).to_have_text('Codex')
    page.locator('#search-dialog-info .session-identity').click()
    check_tip(page, ID)
    page.locator('#search-dialog-close').click()
    expect(page.locator('#session-identity-tooltip')).to_be_hidden()
    assert not errors, errors
    browser.close()
    print('PASS: touch, polling, dismissal, session switching, fullscreen, discovery, statistics and search IDs')
