import { describe, expect, it } from 'vitest';
import { batchTabs, completePlan, contentType, eligible, isWebsiteInstruction, localStrategies, websiteKey } from '../src/lib/grouping';
import { DEFAULTS } from '../src/lib/storage';
import { tab } from './mock';
describe('local strategies',()=>{
  it('groups domains without making network requests',()=>{
    const result=localStrategies([tab(1,'https://www.youtube.com/watch?v=1'),tab(2,'https://www.youtube.com/watch?v=2'),tab(3,'https://github.com/a/b')],DEFAULTS);
    expect(result.map(s=>s.id)).toEqual(['website','content-type']);
    expect(result[0].groups[0]).toMatchObject({name:'youtube.com',tabIds:[1,2]});
    expect(result[1].groups.find(g=>g.name==='Code')?.tabIds).toEqual([3]);
  });
  it.each([['https://youtube.com/watch','video'],['https://github.com/a','code'],['https://docs.google.com/a','docs'],['https://x.com/a','social'],['https://amazon.com/a','shopping'],['https://google.com/search?q=x','search'],['https://example.com/blog/a','article'],['https://example.com/a','other']])('classifies %s',(url,kind)=>expect(contentType(tab(1,url))).toBe(kind));
  it('does not guess registrable domains',()=>{expect(websiteKey('a.company.co.uk',true)).toBe('a.company.co.uk');expect(websiteKey('mail.google.com',true)).toBe('google.com');});
  it('keeps pinned, incognito and existing groups by default',()=>{
    expect(eligible([tab(1),tab(2,undefined,{pinned:true}),tab(3,undefined,{incognito:true}),tab(4,undefined,{groupId:7})],DEFAULTS).map(t=>t.id)).toEqual([1]);
  });
  it('keeps local strategies even with no eligible tabs',()=>expect(localStrategies([],DEFAULTS)).toHaveLength(2));
  it('only takes the local fast path for clear website instructions',()=>{expect(isWebsiteInstruction('group my tabs by website')).toBe(true);expect(isWebsiteInstruction('merge the book websites and separate videos')).toBe(false);});
  it('adds unassigned tabs to Other without duplicating the group',()=>expect(completePlan({groups:[{name:'Other',color:'grey',tabIds:[1]}]},[tab(1),tab(2)],'other').groups[0].tabIds).toEqual([1,2]));
});
describe('batching',()=>{
  it('preserves every tab once across the 150 boundary',()=>{const tabs=Array.from({length:301},(_,i)=>i);const batches=batchTabs(tabs);expect(batches.map(b=>b.length)).toEqual([150,150,1]);expect(batches.flat()).toEqual(tabs);});
  it('rejects zero/negative/fractional batch sizes',()=>{for(const n of [0,-1,1.5])expect(()=>batchTabs([1],n)).toThrow();});
});
