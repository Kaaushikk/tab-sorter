import { beforeEach, describe, expect, it } from 'vitest';
import { makeGroup, readWindow } from '../src/lib/browser';
import { applyPlan, beginSnapshot, checkpoint, recoverWindow, remapSnapshot, undoSnapshot } from '../src/lib/undo';
import { snapshots } from '../src/lib/storage';
import { browserMock, tab } from './mock';
import type { Strategy } from '../src/lib/types';

const strategy: Strategy={id:'test',label:'Test grouping',description:'Test',groups:[{name:'One',color:'blue',tabIds:[1,2]},{name:'Two',color:'red',tabIds:[3,4]}]};
let mock:ReturnType<typeof browserMock>;
beforeEach(()=>{mock=browserMock([tab(1),tab(2),tab(3),tab(4),tab(50,'https://private.example/other-window',{windowId:2,index:0})]);});
describe('strict window isolation',()=>{
  it('never reads another window during apply and undo',async()=>{
    const s=await applyPlan(1,strategy,'keep'); await undoSnapshot(1,s.id);
    expect(mock.api.tabs.query.mock.calls.every(([q])=>q.windowId===1)).toBe(true);
    expect(mock.api.tabGroups.query.mock.calls.every(([q])=>q.windowId===1)).toBe(true);
    expect(mock.tabs.find(t=>t.id===50)?.groupId).toBe(-1);
    expect(JSON.stringify(mock.local)).not.toContain('private.example');
  });
  it('rejects a cross-window tab ID before mutation',async()=>{await expect(makeGroup(1,[1,50])).rejects.toThrow();expect(mock.api.tabs.group).not.toHaveBeenCalled();});
  it('rejects an unspecified window',async()=>{await expect(readWindow(-1)).rejects.toThrow();expect(mock.api.tabs.query).not.toHaveBeenCalled();});
  it('feature-detects tabGroups',async()=>{mock.api.tabGroups.query=undefined as never;await expect(readWindow(1)).rejects.toThrow(/unavailable/);});
});
describe('undo',()=>{
  it('restores a whole snapshot and tab order',async()=>{
    const s=await applyPlan(1,strategy,'keep'); const result=await undoSnapshot(1,s.id);
    expect(result).toMatchObject({restored:4,skipped:0});expect(mock.tabs.filter(t=>t.windowId===1).map(t=>t.groupId)).toEqual([-1,-1,-1,-1]);
    expect(mock.tabs.filter(t=>t.windowId===1).sort((a,b)=>a.index-b.index).map(t=>t.id)).toEqual([1,2,3,4]);
  });
  it('undoes one group while leaving the other untouched',async()=>{
    const s=await applyPlan(1,strategy,'keep'), other=structuredClone(mock.groups.find(g=>g.id===s.created[1].groupId));
    expect(await undoSnapshot(1,s.id,s.created[0].groupId)).toMatchObject({restored:2,skipped:0});
    expect(mock.tabs.filter(t=>[3,4].includes(t.id)).every(t=>t.groupId===other!.id)).toBe(true);expect(mock.groups.find(g=>g.id===other!.id)).toEqual(other);
    expect(await undoSnapshot(1,s.id)).toMatchObject({restored:2,skipped:0});
  });
  it('skips closed tabs without reopening them',async()=>{const s=await applyPlan(1,strategy,'keep');mock.setTabs(mock.tabs.filter(t=>t.id!==1));expect(await undoSnapshot(1,s.id,s.created[0].groupId)).toMatchObject({restored:1,skipped:1});});
  it('leaves tabs manually moved to another group or window alone',async()=>{
    const s=await applyPlan(1,strategy,'keep');mock.tabs.find(t=>t.id===1)!.groupId=s.created[1].groupId;mock.tabs.find(t=>t.id===2)!.windowId=2;
    expect(await undoSnapshot(1,s.id,s.created[0].groupId)).toMatchObject({restored:0,skipped:2});expect(mock.tabs.find(t=>t.id===1)!.groupId).toBe(s.created[1].groupId);expect(mock.tabs.find(t=>t.id===2)!.windowId).toBe(2);
  });
  it('restores into an existing previous group',async()=>{
    mock.tabs.find(t=>t.id===1)!.groupId=7;mock.tabs.find(t=>t.id===3)!.groupId=7;mock.setGroups([{id:7,title:'Original',color:'green',collapsed:true}]);
    const s=await applyPlan(1,{...strategy,groups:[strategy.groups[0]]},'dissolve');
    expect(await undoSnapshot(1,s.id)).toMatchObject({restored:2,skipped:0});expect(mock.tabs.find(t=>t.id===1)!.groupId).toBe(7);expect(mock.groups.find(g=>g.id===7)).toMatchObject({title:'Original',color:'green',collapsed:true});
  });
  it('recreates a disappeared old group',async()=>{
    mock.tabs.find(t=>t.id===1)!.groupId=7;mock.tabs.find(t=>t.id===2)!.groupId=7;mock.setGroups([{id:7,title:'Original',color:'green',collapsed:true}]);
    const s=await applyPlan(1,strategy,'dissolve');expect(await undoSnapshot(1,s.id,s.created[0].groupId)).toMatchObject({restored:2,skipped:0});
    const g=mock.groups.find(g=>g.title==='Original')!;expect(g).toMatchObject({color:'green',collapsed:true});expect(mock.tabs.filter(t=>[1,2].includes(t.id)).every(t=>t.groupId===g.id)).toBe(true);
  });
  it('does not overwrite conflicting changes to a prior group',async()=>{
    mock.tabs.find(t=>t.id===1)!.groupId=7;mock.tabs.find(t=>t.id===3)!.groupId=7;mock.setGroups([{id:7,title:'Original',color:'green',collapsed:false}]);
    const s=await applyPlan(1,{...strategy,groups:[strategy.groups[0]]},'dissolve');mock.groups.find(g=>g.id===7)!.title='Edited manually';
    expect(await undoSnapshot(1,s.id)).toMatchObject({restored:1,skipped:1});expect(mock.groups.find(g=>g.id===7)!.title).toBe('Edited manually');
  });
  it('restores ungroup-all snapshots',async()=>{
    const applied=await applyPlan(1,strategy,'keep');const s=await beginSnapshot(1,'Ungroup all');await mock.api.tabs.ungroup([1,2,3,4]);await checkpoint(s,true);
    expect(await undoSnapshot(1,s.id)).toMatchObject({restored:4,skipped:0});expect(mock.groups.map(g=>g.title).sort()).toEqual(applied.afterGroups.map(g=>g.title).sort());
  });
  it('limits history to five snapshots per window',async()=>{for(let i=0;i<7;i++)await beginSnapshot(1,`Action ${i}`);expect(await snapshots(1)).toHaveLength(5);});
  it('survives a killed worker because checkpoints are durable',async()=>{const s=await applyPlan(1,strategy,'keep');delete mock.session.epoch;mock.session.epoch='test-epoch';expect((await snapshots(1))[0].created).toEqual(s.created);expect(await undoSnapshot(1,s.id)).toMatchObject({restored:4});});
});
describe('restart recovery',()=>{
  it('rematches changed window, tab and group IDs by URL and metadata',async()=>{
    const s=await applyPlan(1,strategy,'keep');
    const nextTabs=s.after.map(t=>({...t,id:t.id+1000,windowId:9,groupId:t.groupId+1000}));const nextGroups=s.afterGroups.map(g=>({...g,id:g.id+1000}));
    const mapped=remapSnapshot(s,nextTabs,nextGroups,'new-epoch',9)!;expect(mapped.created[0].groupId).toBe(s.created[0].groupId+1000);expect(mapped.before[0].id).toBe(1001);
    mock.setTabs(nextTabs);mock.setGroups(nextGroups);mock.session.epoch='new-epoch';await recoverWindow(9);
    expect(await undoSnapshot(9,s.id)).toMatchObject({restored:4,skipped:0});expect(mock.api.tabs.query.mock.calls.slice(-1)[0][0].windowId).toBe(9);
  });
  it('skips duplicate URLs instead of guessing identity',async()=>{
    const s=await applyPlan(1,strategy,'keep');const nextTabs=s.after.map(t=>({...t,id:t.id+1000,windowId:9,groupId:t.groupId+1000}));nextTabs[1].url=nextTabs[0].url;
    const mapped=remapSnapshot(s,nextTabs,s.afterGroups.map(g=>({...g,id:g.id+1000})),'restart',9)!;
    expect(mapped.before.find(t=>t.url===s.before[0].url)!.id).toBeLessThan(0);
  });
});
