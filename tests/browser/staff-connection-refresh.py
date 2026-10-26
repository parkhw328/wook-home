"""Synthetic layer-preview server only: refresh drafts, conflicts and lost observation."""
import json
import os
from playwright.sync_api import sync_playwright, expect

BASE = f"http://127.0.0.1:{os.environ.get('LAYER_TEST_PORT', '18086')}"


def management(page):
    panel = page.locator('.office-management')
    if not panel.evaluate('(e) => e.open'):
        panel.locator('summary').first.click()


def geometry(page, selector):
    result = page.locator(selector).evaluate('''dialog => {
      const controls = [...dialog.querySelectorAll('button, input, select, textarea')].filter(e => e.checkVisibility());
      const text = [...dialog.querySelectorAll('h2, p, label, button, input, select, textarea, small')].filter(e => e.checkVisibility());
      const close = dialog.querySelector('[data-layer-close]').getBoundingClientRect();
      return {overflow: dialog.scrollWidth > dialog.clientWidth + 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        minFont: Math.min(...text.map(e => parseFloat(getComputedStyle(e).fontSize))),
        controls: controls.every(e => parseFloat(getComputedStyle(e).fontSize) >= 16 && e.getBoundingClientRect().height >= 44),
        closeVisible: close.top >= 0 && close.bottom <= innerHeight};
    }''')
    assert not result['overflow'] and not result['pageOverflow'], result
    assert result['minFont'] >= 14 and result['controls'] and result['closeVisible'], result
    return result


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    for theme in ['light', 'dark']:
        for width in [320, 1366]:
            page = browser.new_page(viewport={'width': width, 'height': 1000}, reduced_motion='reduce')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script(f"localStorage.setItem('wook-home.theme', '{theme}')")
            page.goto(BASE + '/#agents')
            expect(page.locator('html')).to_have_attribute('data-theme', theme)
            management(page)
            page.locator('[data-connect-entry]').first.click()
            expect(page.locator('#staff-name')).to_be_visible()
            entry_id = page.locator('#staff-entry').input_value()
            page.locator('#staff-name').fill('초안 이름')
            page.locator('#staff-role').fill('초안 역할')
            page.locator('#register-project').fill('초안 프로젝트')
            page.locator('[data-staff-refresh]').click()
            expect(page.locator('#staff-name')).to_have_value('초안 이름')
            expect(page.locator('#staff-role')).to_have_value('초안 역할')
            expect(page.locator('#register-project')).to_have_value('초안 프로젝트')
            expect(page.locator('#staff-entry')).to_have_value(entry_id)
            picker_geometry = geometry(page, '#staff-connection-dialog')

            # A second screen changes the employee after this picker has read its version.
            state = page.request.get(BASE + '/api/state').json()
            agent = next(a for a in state['agents'] if a['name'] == '연결 전 직원')
            old_revision = agent['settingsRevision']
            page.locator('#staff-employee').select_option(agent['id'])
            changed = page.request.patch(BASE + '/api/agents/' + agent['id'], data={
                'name': agent['name'], 'role': agent['role'], 'projectName': f'다른 화면 {theme} {width}',
                'settingsRevision': old_revision,
            })
            assert changed.ok, changed.status
            new_revision = changed.json()['settingsRevision']
            with page.expect_response(lambda r: r.request.method == 'PUT' and r.url.endswith('/connection')) as response:
                page.locator('#staff-submit').click()
            assert response.value.status == 409
            assert response.value.request.post_data_json['settingsRevision'] == old_revision
            expect(page.locator('#staff-error')).to_be_visible()
            expect(page.locator('#staff-entry')).to_have_value(entry_id)
            expect(page.locator('#staff-employee')).to_have_value(agent['id'])
            expect(page.locator('#staff-submit')).to_be_enabled()
            # Explicit refresh acknowledges the new version, while preserving chosen target and fields.
            page.locator('[data-staff-refresh]').click()
            expect(page.locator('#staff-employee')).to_have_value(agent['id'])
            expect(page.locator('#staff-entry')).to_have_value(entry_id)
            expect(page.locator('#staff-name')).to_have_value('초안 이름')
            with page.expect_response(lambda r: r.request.method == 'PUT' and r.url.endswith('/connection')) as response:
                page.locator('#staff-submit').click()
            assert response.value.ok
            assert response.value.request.post_data_json['settingsRevision'] == new_revision
            expect(page.locator('#modal')).to_be_visible()
            expect(page.locator('#modal-title')).to_have_text(agent['name'])
            linked = response.value.json()
            with page.expect_response(lambda r: r.request.method == 'DELETE' and r.url.endswith('/connection')) as deletion:
                page.locator('[data-disconnect-agent]').click()
            assert deletion.value.ok
            assert deletion.value.request.post_data_json['settingsRevision'] == linked['settingsRevision']
            expect(page.locator('#modal')).to_be_visible()
            expect(page.locator('#modal-title')).to_have_text(agent['name'])
            # Failed initial reads must retain the explicitly requested employee on retry.
            page.route('**/api/discovery', lambda route: route.abort())
            page.locator('[data-connect-agent]').click()
            expect(page.locator('#staff-connection-dialog [role="alert"]')).to_be_visible()
            page.unroute('**/api/discovery')
            page.locator('[data-staff-refresh]').click()
            expect(page.locator('#staff-employee')).to_have_value(agent['id'])
            expect(page.locator('#staff-employee option')).to_have_count(1)
            page.keyboard.press('Escape')

            # Existing valid observation must turn red immediately on a failed office poll.
            page.locator('#agent-list [data-agent]').filter(has_text='검증 직원').click()
            page.locator('[data-cli-agent]').click()
            expect(page.locator('.staff-connection-box [data-tone]')).to_have_attribute('data-tone', 'healthy')
            page.locator('#session-command').fill('연결 복구 전후 보존할 지시')
            page.route('**/api/state', lambda route: route.abort())
            expect(page.locator('#connection-status')).to_contain_text('서버 연결 끊김', timeout=8000)
            expect(page.locator('.staff-connection-box [data-tone]')).to_have_attribute('data-tone', 'error')
            expect(page.locator('.staff-connection-box')).to_contain_text('마지막으로 받은 정보')
            expect(page.locator('#session-command')).to_have_value('연결 복구 전후 보존할 지시')
            detail_geometry = geometry(page, '#modal')
            page.unroute('**/api/state')
            expect(page.locator('#connection-status')).to_contain_text('로컬 서버 연결됨', timeout=8000)
            expect(page.locator('.staff-connection-box [data-tone]')).to_have_attribute('data-tone', 'healthy')
            expect(page.locator('#session-command')).to_have_value('연결 복구 전후 보존할 지시')
            assert not errors, errors
            print(json.dumps({'theme': theme, 'width': width, 'drafts': 'preserved', 'conflict': '409',
                              'disconnectRevision': 'verified', 'observation': 'offline and recovered',
                              'picker': picker_geometry, 'detail': detail_geometry}), flush=True)
            page.close()
    browser.close()
