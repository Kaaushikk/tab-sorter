import { beforeEach, expect, it, vi } from 'vitest';
import { browserMock, tab } from './mock';
import { DEFAULTS } from '../src/lib/storage';
import type { Command, Response, WindowState } from '../src/lib/types';
let mock:ReturnType<typeof browserMock>;
type Listener=(c:Command,sender:{id:string;url:string},reply:(value:Response<unknown>)=>void)=>boolean;
let listener:Listener;
async function send<T>(c:Command):Promise<T> {
  const r=await new Promise<Response<T>>(resolve=>listener(c,{id:'extension-test',url:'chrome-extension://extension-test/popup.html'},resolve as (value:Response<unknown>)=>void));
  if(!r.ok)throw new Error(r.error);return r.value;
}
beforeEach(async()=>{
  vi.resetModules();mock=browserMock([tab(1),tab(2),tab(3,'https://github.com/example/project'),tab(50,'https://private.example',{windowId:2})]);
  await import('../src/background/index');listener=(mock.api.runtime.onMessage.addListener.mock.calls as unknown as [Listener][])[0][0];
});
it('loads two local strategies without returning the API key or other-window tabs',async()=>{
  mock.local.settings={...DEFAULTS,apiKey:'not-a-real-key'};
  const s=await send<WindowState>({type:'load',windowId:1});expect(s.strategies.map(x=>x.id)).toEqual(['website','content-type']);expect(s.tabs).toHaveLength(3);expect(s.settings).not.toHaveProperty('apiKey');expect(JSON.stringify(s)).not.toContain('private.example');
});
it('rejects a plan when a tab navigates after preview',async()=>{
  const s=await send<WindowState>({type:'load',windowId:1});mock.tabs[0].url='https://new.example';
  await expect(send({type:'apply',windowId:1,strategy:s.strategies[0]})).rejects.toThrow(/changed since/);expect(mock.api.tabs.group).not.toHaveBeenCalled();
});
it('applies and undoes through the actual background command handler',async()=>{
  const s=await send<WindowState>({type:'load',windowId:1});await send({type:'apply',windowId:1,strategy:s.strategies[0]});
  const applied=await send<WindowState>({type:'load',windowId:1});expect(applied.snapshots).toHaveLength(1);
  expect(await send({type:'undo',windowId:1,snapshotId:applied.snapshots[0].id})).toMatchObject({restored:3,skipped:0});expect(mock.tabs.every(t=>t.groupId===-1)).toBe(true);
});
it('rejects AI plan IDs that are now excluded',async()=>{
  const s=await send<WindowState>({type:'load',windowId:1});mock.local.settings={...DEFAULTS,excludedDomains:['example.com']};
  await expect(send({type:'apply',windowId:1,strategy:{...s.strategies[0],id:'ai:topic'}})).rejects.toThrow();expect(mock.api.tabs.group).not.toHaveBeenCalled();
});
it('drops AI preview plans when their tabs have changed',async()=>{
  const s=await send<WindowState>({type:'load',windowId:1});mock.session['preview:1']={tabs:structuredClone(s.tabs),strategies:[{...s.strategies[0],id:'ai:topic'}]};
  expect((await send<WindowState>({type:'load',windowId:1})).strategies).toHaveLength(3);
  mock.tabs[0].url='https://changed.example';expect((await send<WindowState>({type:'load',windowId:1})).strategies).toHaveLength(2);
});
it('does not accept messages from a website',()=>{expect(listener({type:'load',windowId:1},{id:'other',url:'https://malicious.example'},()=>{})).toBe(false);expect(mock.api.tabs.query).not.toHaveBeenCalled();});
