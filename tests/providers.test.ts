import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvider, customPlan, suggest, validatedCall } from '../src/lib/providers';
import { DEFAULTS } from '../src/lib/storage';
import { validatePlan } from '../src/lib/validation';
import { browserMock, tab } from './mock';
beforeEach(()=>browserMock());afterEach(()=>vi.unstubAllGlobals());
describe('provider validation',()=>{
  it('retries malformed JSON once',async()=>{const complete=vi.fn().mockResolvedValueOnce('invalid').mockResolvedValueOnce('{"groups":[{"name":"One","color":"blue","tabIds":[1]}]}');await expect(validatedCall({complete},'',{},x=>validatePlan(x,new Set([1])))).resolves.toMatchObject({groups:[{tabIds:[1]}]});expect(complete).toHaveBeenCalledTimes(2);});
  it('stops after two invalid responses',async()=>{const complete=vi.fn().mockResolvedValue('oops');await expect(validatedCall({complete},'',{},x=>validatePlan(x,new Set()))).rejects.toThrow(/twice/);expect(complete).toHaveBeenCalledTimes(2);});
  it('takes website instructions locally with no AI configuration',async()=>{vi.stubGlobal('fetch',vi.fn());expect((await customPlan([tab(1)],DEFAULTS,'group by website')).id).toBe('website');expect(fetch).not.toHaveBeenCalled();});
  it.each(['anthropic','openai','ollama'] as const)('formats %s requests and never follows redirects',async kind=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify(kind==='anthropic'?{content:[{type:'text',text:'{"groups":[]}'}]}:kind==='ollama'?{message:{content:'{"groups":[]}'}}:{choices:[{message:{content:'{"groups":[]}'}}]})));
    vi.stubGlobal('fetch',fetchMock);
    await createProvider({...DEFAULTS,provider:kind,apiKey:'test-placeholder',model:'test-model',baseUrl:kind==='ollama'?'http://localhost:11434':DEFAULTS.baseUrl}).complete('system','input');
    const [url,request]=fetchMock.mock.calls[0];expect(request).toMatchObject({credentials:'omit',redirect:'error'});
    expect(url).toContain(kind==='anthropic'?'/v1/messages':kind==='ollama'?'/api/chat':'/v1/chat/completions');
    if(kind==='anthropic')expect(request.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });
  it('never includes excluded tab data in a refinement',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'{"groups":[{"name":"Public","color":"blue","tabIds":[1]}]}'}}]})));
    vi.stubGlobal('fetch',fetchMock);
    await customPlan([tab(1),tab(2,'https://bank.example/private')],{...DEFAULTS,provider:'openai',apiKey:'test-placeholder',model:'test',excludedDomains:['bank.example']},'refine',{id:'website',label:'Website',description:'local',groups:[{name:'example.com',color:'blue',tabIds:[1]},{name:'bank.example',color:'red',tabIds:[2]}]});
    expect(fetchMock.mock.calls[0][1].body).not.toContain('bank.example');
  });
  it('batches over 150 tabs and carries consistent names',async()=>{
    const fetchMock=vi.fn().mockImplementation(async (_url,init)=>{
      const data=JSON.parse(JSON.parse(init.body).messages[1].content), ids=data.tabs.map((t:{id:number})=>t.id);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({strategies:['topic','content-type','website'].map((id,i)=>({id,label:id,description:'A plan',groups:[{name:'Shared',color:'blue',tabIds:ids.filter((_:number,n:number)=>n%(i+2)===0)},{name:'Rest',color:'red',tabIds:ids.filter((_:number,n:number)=>n%(i+2)!==0)}].filter(g=>g.tabIds.length)}))})}}]}));
    });vi.stubGlobal('fetch',fetchMock);
    const tabs=Array.from({length:151},(_,i)=>tab(i+1));const plans=await suggest(tabs,{...DEFAULTS,provider:'openai',model:'test',apiKey:'test-placeholder'});
    expect(fetchMock).toHaveBeenCalledTimes(2);expect(plans[0].groups.find(g=>g.name==='Shared')!.tabIds).toContain(151);
    expect(new Set(plans[0].groups.flatMap(g=>g.tabIds)).size).toBe(151);expect(fetchMock.mock.calls[1][1].body).toContain('reference');
  });
});
