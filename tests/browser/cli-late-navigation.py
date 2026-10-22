"""Synthetic layer-preview fixture only: delay real task answers across CLI interactions."""
import json,os
from playwright.sync_api import sync_playwright,expect
base=f"http://127.0.0.1:{os.environ.get('LAYER_TEST_PORT', '18084')}"
results=[]
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,args=['--no-sandbox'])
    for path in ['session','agent']:
        for dismiss in [False,True]:
            page=b.new_page(viewport={'width':1366,'height':1000},reduced_motion='reduce')
            agent=page.request.post(base+'/api/agents',data={'name':'늦은 응답 검증','role':'검증','provider':'demo'}).json()
            task=page.request.post(base+'/api/tasks',data={'agentId':agent['id'],'title':'늦은 응답 검증'}).json()
            page.goto(base+'/#tasks')
            # Keep native scroll anchoring/report height changes separate from app navigation.
            page.evaluate("()=>{document.documentElement.style.overflowAnchor='none';document.body.style.minHeight='20000px'}")
            page.locator('#task-list [data-task="'+task['id']+'"]').first.click()
            expect(page.locator('#report-answer')).to_be_visible();page.locator('#report-answer').fill('검증 답변')
            held=[]
            page.route('**/api/tasks/*/messages',lambda route:held.append(route))
            page.locator('#report-answer-submit').click()
            expect(page.locator('#report-answer-submit')).to_be_disabled()
            page.wait_for_timeout(100)
            panel=page.locator('.office-management')
            if not panel.evaluate('(e)=>e.open'):panel.locator('summary').first.click()
            entry=page.locator('#session-list [data-session]').first if path=='session' else page.locator('#agent-list [data-agent]').filter(has_text='검증 직원').first
            entry.click();expect(page.locator('#cli-dialog-log article').first).to_be_visible()
            if dismiss:page.keyboard.press('Escape')
            page.evaluate('''()=>{window.lateMoves=[];const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...args){if(this.id==='workbench-detail')window.lateMoves.push(this.id);return original.apply(this,args)}}''')
            before=page.evaluate('({scroll:scrollY,focus:document.activeElement.id})')
            response=held[0].fetch();held[0].fulfill(response=response)
            expect(page.locator('#report-answer-submit')).not_to_be_disabled()
            page.wait_for_timeout(500)
            after=page.evaluate('({scroll:scrollY,focus:document.activeElement.id,moves:window.lateMoves,open:!!document.querySelector("#cli-conversation-dialog[open]")})')
            result={'path':path,'dismiss':dismiss,'before':before,'after':after,'pass':not after['moves'] and before['scroll']==after['scroll'] and before['focus']==after['focus'] and after['open']==(not dismiss)}
            results.append(result)
            print(json.dumps(result),flush=True)
            page.close()
    b.close()

assert all(result['pass'] for result in results), 'Late task response stole navigation after CLI interaction'
