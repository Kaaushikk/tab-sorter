import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserMock, tab } from './mock';
import { DEFAULTS, FAST_OPENROUTER_MODEL } from '../src/lib/storage';
import type { AiJob, Command, Response as CommandResponse, WindowState } from '../src/lib/types';
let mock:ReturnType<typeof browserMock>;
type Listener=(c:Command,sender:{id:string;url:string},reply:(value:CommandResponse<unknown>)=>void)=>boolean;
let listener:Listener;
async function send<T>(c:Command):Promise<T> {
  const r=await new Promise<CommandResponse<T>>(resolve=>listener(c,{id:'extension-test',url:'chrome-extension://extension-test/popup.html'},resolve as (value:CommandResponse<unknown>)=>void));
  if(!r.ok)throw new Error(r.error);return r.value;
}
beforeEach(async()=>{
  vi.resetModules();mock=browserMock([tab(1),tab(2),tab(3,'https://github.com/example/project'),tab(50,'https://private.example',{windowId:2})]);
  await import('../src/background/index');listener=(mock.api.runtime.onMessage.addListener.mock.calls as unknown as [Listener][])[0][0];
});
afterEach(()=>vi.unstubAllGlobals());
const freeSettings = { ...DEFAULTS, provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: 'test-placeholder' } as const;
const status = (windowId = 1) => send<AiJob | null>({ type: 'aiStatus', windowId });
const sse = (content: string) => `data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`;
function suggestionOutput(): string {
  return JSON.stringify({ strategies: [[1,2],[1,3],[2,3]].map((pair,i)=>({id:`strategy-${i}`,label:`Strategy ${i}`,description:'Synthetic test grouping',groups:[{name:'Related',color:'blue',tabIds:pair},{name:'Other',color:'grey',tabIds:[1,2,3].filter(id=>!pair.includes(id))}]})) });
}
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
it('returns streamed suggestions through the background without grouping any tabs',async()=>{
  mock.local.settings={...freeSettings};
  const wire=': OPENROUTER PROCESSING\n\n'+sse(suggestionOutput())+'data: [DONE]\n\n';
  const fetchMock=vi.fn().mockResolvedValue(new Response(wire,{headers:{'content-type':'text/event-stream'}}));
  vi.stubGlobal('fetch',fetchMock);
  const result=await send<{state:WindowState}>({type:'suggest',windowId:1});expect(result.state.strategies.filter(s=>s.id.startsWith('ai:'))).toHaveLength(3);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({model:FAST_OPENROUTER_MODEL,reasoning:{enabled:false,exclude:true}});
  expect(await status()).toMatchObject({status:'succeeded',model:FAST_OPENROUTER_MODEL});
  expect(mock.api.tabs.group).not.toHaveBeenCalled();expect(mock.api.tabs.ungroup).not.toHaveBeenCalled();expect(mock.tabs.every(t=>t.groupId===-1)).toBe(true);
});
it('reports connection, waiting and receiving while a suggestion runs, then aborts it on cancel',async()=>{
  mock.local.settings={...freeSettings};
  const encoder=new TextEncoder();
  let stream!:ReadableStreamDefaultController<Uint8Array>, headers!:()=>void;
  let signal:AbortSignal|undefined;
  vi.stubGlobal('fetch',vi.fn().mockImplementation((_url, init:RequestInit)=>new Promise<Response>((resolve,reject)=>{
    signal=init.signal!;
    headers=()=>resolve(new Response(new ReadableStream({start(c){stream=c;signal!.addEventListener('abort',()=>c.error(signal!.reason),{once:true});}}),{headers:{'content-type':'text/event-stream'}}));
    signal.addEventListener('abort',()=>reject(signal!.reason),{once:true});
  })));
  const pending=send({type:'suggest',windowId:1,requestId:'cancelled-job'}).catch((error:Error)=>error.message);
  try {
    await vi.waitFor(()=>expect(headers).toBeTypeOf('function'));
    expect(await status()).toMatchObject({id:'cancelled-job',stage:'connecting',status:'running'});
    headers();await vi.waitFor(async()=>expect(await status()).toMatchObject({stage:'waiting'}));
    stream.enqueue(encoder.encode(sse('{"strategies":')));
    await vi.waitFor(async()=>expect(await status()).toMatchObject({stage:'receiving',characters:14}));
    expect((await send<WindowState>({type:'load',windowId:2})).tabs.map(t=>t.id)).toEqual([50]);
    expect(await status(2)).toBeNull();
    await send({type:'cancelAi',windowId:2,requestId:'cancelled-job'});expect(signal?.aborted).toBe(false);
    expect(await send({type:'cancelAi',windowId:1,requestId:'cancelled-job'})).toEqual({cancelled:true});
    expect(await pending).toMatch(/AI request cancelled/);expect(signal?.aborted).toBe(true);
    expect(await status()).toMatchObject({status:'cancelled'});
    expect(mock.session['preview:1']).toBeUndefined();expect(mock.api.tabs.group).not.toHaveBeenCalled();
    expect(JSON.stringify(await status())).not.toContain('test-placeholder');
  } finally {
    if(!signal?.aborted) await send({type:'cancelAi',windowId:1,requestId:'cancelled-job'});
    await pending;
  }
});
it('keeps the retry attempt visible until the second response arrives',async()=>{
  mock.local.settings={...freeSettings};let finish!:()=>void;
  const fetchMock=vi.fn().mockResolvedValueOnce(new Response(sse('not JSON')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})).mockImplementationOnce((_url,init:RequestInit)=>new Promise<Response>((resolve,reject)=>{
    finish=()=>resolve(new Response(sse(suggestionOutput())+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
    init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true});
  }));
  vi.stubGlobal('fetch',fetchMock);
  const pending=send<{state:WindowState}>({type:'suggest',windowId:1,requestId:'retried-job'});
  try {
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    expect(await status()).toMatchObject({stage:'connecting',attempt:2,status:'running'});
    finish();const result=await pending;
    expect(result.state.strategies.filter(s=>s.id.startsWith('ai:'))).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);expect(await status()).toMatchObject({status:'succeeded',attempt:2});
  } finally { if (finish) finish(); await pending.catch(()=>undefined); }
});
it('honors cancellation that arrives before a request starts without using the provider',async()=>{
  mock.local.settings={...freeSettings};const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  await send({type:'cancelAi',windowId:1,requestId:'early-cancel'});
  await expect(send({type:'suggest',windowId:1,requestId:'early-cancel'})).rejects.toThrow(/AI request cancelled/);
  expect(fetchMock).not.toHaveBeenCalled();expect(await status()).toMatchObject({status:'cancelled'});
});
it('reports a browser-interrupted job rather than showing a permanent spinner',async()=>{
  mock.session['ai-job:1']={id:'old-job',stage:'waiting',status:'running',model:FAST_OPENROUTER_MODEL,startedAt:Date.now(),updatedAt:Date.now()};
  expect(await status()).toMatchObject({status:'failed',error:expect.stringContaining('browser interrupted')});
});
it('reports body-read timeouts clearly and leaves tabs unchanged',async()=>{
  mock.local.settings={...DEFAULTS,provider:'openai',baseUrl:'https://openrouter.ai/api/v1',model:'openrouter/free',apiKey:'test-placeholder'};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({start(controller){controller.error(new DOMException('signal timed out','TimeoutError'));}}))));
  await expect(send({type:'suggest',windowId:1})).rejects.toThrow(/AI provider took too long/);
  expect(mock.api.tabs.group).not.toHaveBeenCalled();expect(mock.api.tabs.ungroup).not.toHaveBeenCalled();
});
