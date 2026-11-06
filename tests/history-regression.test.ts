import { beforeEach, expect, it } from 'vitest';
import { browserMock, tab } from './mock';
import { applyPlan, recoverWindow, remapSnapshot, undoSnapshot } from '../src/lib/undo';
import { snapshots } from '../src/lib/storage';
import type { Strategy } from '../src/lib/types';
let mock:ReturnType<typeof browserMock>;
const strategy:Strategy={id:'test',label:'Test',description:'Test',groups:[{name:'First',color:'blue',tabIds:[1,2]},{name:'Second',color:'red',tabIds:[3,4]}]};
beforeEach(()=>{mock=browserMock([tab(1),tab(2),tab(3),tab(4)]);});
it('restores one original group across two separate per-group undos',async()=>{
  for(const t of mock.tabs)t.groupId=7;mock.setGroups([{id:7,title:'Original',color:'green',collapsed:true}]);
  const s=await applyPlan(1,strategy,'dissolve');
  expect(await undoSnapshot(1,s.id,s.created[0].groupId)).toMatchObject({restored:2,skipped:0});
  expect(await undoSnapshot(1,s.id,s.created[1].groupId)).toMatchObject({restored:2,skipped:0});
  expect(mock.groups).toHaveLength(1);expect(mock.groups[0].title).toBe('Original');
});
it('supports whole undo at two levels after previous groups are recreated',async()=>{
  const first=await applyPlan(1,strategy,'keep');
  await new Promise(resolve=>setTimeout(resolve,2));
  const second=await applyPlan(1,{...strategy,label:'Again',groups:[{name:'All',color:'purple',tabIds:[1,2,3,4]}]},'dissolve');
  expect(await undoSnapshot(1,second.id)).toMatchObject({restored:4,skipped:0});
  expect(await undoSnapshot(1,first.id)).toMatchObject({restored:4,skipped:0});
  expect(mock.tabs.every(t=>t.groupId===-1)).toBe(true);
});
it('restores original pinning after grouping included pinned tabs',async()=>{
  mock.tabs[0].pinned=true;const s=await applyPlan(1,strategy,'keep');expect(mock.tabs[0].pinned).toBe(false);
  expect(await undoSnapshot(1,s.id)).toMatchObject({restored:4,skipped:0});expect(mock.tabs[0].pinned).toBe(true);
});
it('undoes a merge that left the last original tab in its existing group',async()=>{
  mock.tabs[0].groupId=7;mock.setGroups([{id:7,title:'First',color:'blue',collapsed:true}]);
  const s=await applyPlan(1,{...strategy,groups:[{name:'First',color:'blue',tabIds:[1]}]},'merge');
  expect(await undoSnapshot(1,s.id)).toMatchObject({restored:1,skipped:0});expect(mock.tabs[0].groupId).toBe(7);
});
it('continues a partially undone snapshot after restart',async()=>{
  for(const t of mock.tabs)t.groupId=7;mock.setGroups([{id:7,title:'Original',color:'green',collapsed:true}]);
  const s=await applyPlan(1,strategy,'dissolve');await undoSnapshot(1,s.id,s.created[0].groupId);
  const nextGroups=mock.groups.map(g=>({...g,id:g.id+1000}));mock.setTabs(mock.tabs.map(t=>({...t,id:t.id+1000,windowId:9,groupId:t.groupId+1000})));mock.setGroups(nextGroups);mock.session.epoch='restart';
  await recoverWindow(9);const mapped=(await snapshots(9))[0];
  expect(await undoSnapshot(9,mapped.id,mapped.created[1].groupId)).toMatchObject({restored:2,skipped:0});expect(mock.groups).toHaveLength(1);expect(mock.groups[0].title).toBe('Original');
});
it('keeps unknown IDs negative across repeated restart remapping',async()=>{
  const s=await applyPlan(1,strategy,'keep');const tabs=mock.tabs.filter(t=>t.id!==1).map(t=>({...t,id:t.id+1000,windowId:9,groupId:t.groupId+1000}));const groups=mock.groups.map(g=>({...g,id:g.id+1000}));
  const once=remapSnapshot(s,tabs,groups,'restart1',9)!;const twice=remapSnapshot(once,tabs.map(t=>({...t,id:t.id+1000})),groups,'restart2',9)!;
  expect(twice.before.find(t=>t.url===s.before[0].url)!.id).toBeLessThan(0);
});
