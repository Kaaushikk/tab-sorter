import { describe, expect, it } from 'vitest';
import { aiTabs, endpointOrigin, excluded } from '../src/lib/sanitize';
import { parseJSON, validatePlan, validateStrategies } from '../src/lib/validation';
import { DEFAULTS } from '../src/lib/storage';
import { tab } from './mock';
describe('outbound data',()=>{
  it('strips query, fragment, and URL credentials',()=>{const out=aiTabs([tab(1,'https://user:password@example.com/article?token=secret#private')],DEFAULTS);expect(out).toEqual([{id:1,title:'Tab 1',hostname:'example.com',path:'/article',contentType:'other'}]);expect(JSON.stringify(out)).not.toMatch(/secret|password|private/);});
  it('titles-only omits hostname/path/type',()=>expect(aiTabs([tab(1)],{...DEFAULTS,titlesOnly:true})).toEqual([{id:1,title:'Tab 1'}]));
  it('never sends excluded domains, internal pages, files or incognito',()=>{
    const tabs=[tab(1,'https://mail.example.com/a'),tab(2,'chrome://settings'),tab(3,'brave://settings'),tab(4,'chrome-extension://abc/page'),tab(5,'file:///C:/private'),tab(6,undefined,{incognito:true})];
    expect(aiTabs(tabs,{...DEFAULTS,excludedDomains:['example.com']})).toEqual([]);
    expect(excluded('notexample.com',['example.com'])).toBe(false);
  });
  it('requires HTTPS remotely and disallows endpoint credentials',()=>{for(const url of ['http://example.com','https://key@example.com','https://example.com/?token=x'])expect(()=>endpointOrigin(url)).toThrow();expect(endpointOrigin('http://localhost:11434')).toBe('http://localhost:11434/*');});
});
describe('strict JSON plans',()=>{
  const valid={groups:[{name:'Reading',color:'blue',tabIds:[1,2]}]}, allowed=new Set([1,2,3]);
  it('parses JSON with an optional code fence',()=>expect(validatePlan(parseJSON('```json\n'+JSON.stringify(valid)+'\n```'),allowed)).toEqual(valid));
  it('rejects unknown and repeated IDs',()=>{for(const tabIds of [[1,99],[1,1]])expect(()=>validatePlan({groups:[{...valid.groups[0],tabIds}]},allowed)).toThrow();});
  it('rejects overlap between groups',()=>expect(()=>validatePlan({groups:[valid.groups[0],{name:'Other',color:'red',tabIds:[2]}]},allowed)).toThrow());
  it('rejects extra fields and unsupported colors',()=>{expect(()=>validatePlan({...valid,code:'evil'},allowed)).toThrow();expect(()=>validatePlan({groups:[{...valid.groups[0],color:'black'}]},allowed)).toThrow();});
  it('requires 3–5 strategies with distinct IDs',()=>{expect(()=>validateStrategies({strategies:[]},allowed)).toThrow();const s={id:'topic',label:'Topic',description:'A plan',groups:valid.groups};expect(()=>validateStrategies({strategies:[s,s,s]},allowed)).toThrow();});
});
