"""Synthetic layer-preview server only: busy work, retained reports and fullscreen."""
from playwright.sync_api import sync_playwright,expect
import os
BASE=f"http://127.0.0.1:{os.environ.get('LAYER_TEST_PORT','18086')}"
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1366,'height':1000},reduced_motion='reduce')
 a=page.request.post(BASE+'/api/agents',data={'name':'기록 담당자','role':'검증','provider':'demo'}).json()
 t=page.request.post(BASE+'/api/tasks',data={'agentId':a['id'],'title':'해제 전 업무'}).json()
 page.goto(BASE);page.locator('#workbench-empty [data-workbench-connections]').click();page.locator(f'[data-stat-agent="{a["id"]}"]').click();page.locator('[data-release-agent]').click();expect(page.locator('[data-confirm-release]')).to_be_disabled()
 page.locator(f'#modal-body [data-task="{t["id"]}"]').click();page.locator('#report-cancel').click();page.locator('[data-confirm-cancel]').click();expect(page.locator('#workbench-status')).to_contain_text('취소')
 page.locator('#workbench-close').click();page.locator('#workbench-empty [data-workbench-connections]').click();page.locator(f'[data-stat-agent="{a["id"]}"]').click();page.locator('[data-release-agent]').click();page.locator('[data-confirm-release]').click();expect(page.locator('#modal-title')).to_have_text('직원 등록 해제 기록');expect(page.locator(f'#modal-body [data-task="{t["id"]}"]')).to_contain_text('기록 담당자');page.locator(f'#modal-body [data-task="{t["id"]}"]').click();expect(page.locator('#report-owner')).to_have_text('기록 담당자')
 page.locator('#office-fullscreen').click();expect(page.locator('#office-workspace')).to_have_class(__import__('re').compile('is-expanded'));page.locator('#room-navigation [data-room="warehouse"]').click();expect(page.locator('#room-heading')).to_have_text('창고');assert page.locator('.office-directory').evaluate('e=>getComputedStyle(e).overflowY')=='visible';page.keyboard.press('Escape');print('Busy release blocked; cancellation, report owner after release and fullscreen navigation passed');b.close()
