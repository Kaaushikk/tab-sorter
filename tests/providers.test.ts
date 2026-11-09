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
  it('builds one topic plan for 835 tabs, merging group names and restoring original IDs', async () => {
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      const data = JSON.parse(JSON.parse(init.body as string).messages[1].content) as {
        tabs: { id: number }[]; existingGroups: { name: string; color: string }[];
      };
      const ids = data.tabs.map(t => t.id);
      const groups = [
        { name: 'Reading', color: 'blue', tabIds: ids.filter(id => id % 2 === 1) },
        { name: 'Projects', color: 'red', tabIds: ids.filter(id => id % 2 === 0) },
      ];
      return Response.json({ choices: [{ message: { content: JSON.stringify({ groups }) } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const tabs = Array.from({ length: 835 }, (_, i) => tab(2_000_001 + i));
    const plans = await suggest(tabs, { ...DEFAULTS, provider: 'openai', model: 'test', apiKey: 'test-placeholder' });
    const inputs = fetchMock.mock.calls.map(([, init]) => JSON.parse(JSON.parse(init.body as string).messages[1].content));
    expect(inputs.map(input => input.tabs.length)).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 35]);
    expect(inputs[1].tabs.map((t: { id: number }) => t.id)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(inputs[1].existingGroups).toEqual([{ name: 'Reading', color: 'blue' }, { name: 'Projects', color: 'red' }]);
    expect(plans).toHaveLength(1);
    expect(plans[0].groups).toHaveLength(2);
    expect(plans[0].groups.flatMap(g => g.tabIds).sort((a, b) => a - b)).toEqual(tabs.map(t => t.id));
  });
});
