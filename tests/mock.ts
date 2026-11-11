import { vi } from 'vitest';
import type { Group, Tab } from '../src/lib/types';
export function tab(id: number, url = `https://example.com/${id}`, extra: Partial<Tab> = {}): Tab {
  return { id, windowId:1, index:id-1, title:`Tab ${id}`, url, hostname:new URL(url).hostname, pinned:false, incognito:false, groupId:-1, ...extra };
}
export function browserMock(initial: Tab[] = [], initialGroups: Group[] = []) {
  let tabs = structuredClone(initial), groups = structuredClone(initialGroups), next = 100;
  const local: Record<string,unknown> = {}, session: Record<string,unknown> = {epoch:'test-epoch'};
  const area = (store: Record<string,unknown>) => ({
    get: vi.fn(async (key: string | null) => structuredClone(key === null ? store : {[key]:store[key]})),
    set: vi.fn(async (items: object) => {Object.assign(store,structuredClone(items));}),
    remove: vi.fn(async (key: string | string[]) => {for(const k of Array.isArray(key)?key:[key]) delete store[k];}),
    setAccessLevel: vi.fn(async () => {}),
  });
  const cleanup = () => { groups = groups.filter(g => tabs.some(t=>t.groupId===g.id)); };
  const api = {
    windows:{
      get:vi.fn(async (id:number) => ({id,type:'normal',incognito:false})),
      getAll:vi.fn<(query: chrome.windows.QueryOptions) => Promise<{ id: number; type: string; incognito: boolean; tabs: Tab[] }[]>>(),
      onRemoved:{addListener:vi.fn()},
    },
    tabs:{
      get:vi.fn(async (id:number) => {const t=tabs.find(t=>t.id===id);if(!t)throw new Error('No such tab');return structuredClone(t);}),
      discard:vi.fn(async (id:number) => {const t=tabs.find(t=>t.id===id);if(!t||t.active||t.discarded)return undefined;t.discarded=true;return structuredClone(t);}),
      query:vi.fn(async (q:{windowId:number}) => {if(!Number.isInteger(q.windowId)) throw new Error('Unscoped tab read'); return structuredClone(tabs.filter(t=>t.windowId===q.windowId));}),
      group:vi.fn(async (o:{tabIds:number[];groupId?:number;createProperties?:{windowId:number}}) => {
        const id=o.groupId??next++; if(o.groupId===undefined) groups.push({id,title:'',color:'grey',collapsed:false});
        for(const t of tabs) if(o.tabIds.includes(t.id)) { if(o.createProperties && t.windowId!==o.createProperties.windowId) throw new Error('Cross-window mutation'); t.groupId=id; }
        cleanup(); return id;
      }),
      ungroup:vi.fn(async (ids:number[]) => {for(const t of tabs) if(ids.includes(t.id)) t.groupId=-1; cleanup();}),
      update:vi.fn(async (id:number,changes:Partial<Tab>) => {Object.assign(tabs.find(t=>t.id===id)!,changes);}),
      move:vi.fn(async (id:number,{index}:{index:number}) => {const t=tabs.find(t=>t.id===id)!; const order=tabs.filter(x=>x.windowId===t.windowId).sort((a,b)=>a.index-b.index).filter(x=>x.id!==id);order.splice(index,0,t);order.forEach((x,i)=>x.index=i);}),
    },
    tabGroups:{query:vi.fn(async (q:{windowId:number}) => structuredClone(groups.filter(g=>tabs.some(t=>t.windowId===q.windowId&&t.groupId===g.id)).map(g=>({...g,windowId:q.windowId})))),update:vi.fn(async (id:number,p:object) => {Object.assign(groups.find(g=>g.id===id)!,p);})},
    storage:{local:area(local),session:area(session)},
    permissions:{contains:vi.fn(async()=>true)},
    runtime:{id:'extension-test',getURL:(p:string)=>`chrome-extension://extension-test/${p}`,onMessage:{addListener:vi.fn()},onInstalled:{addListener:vi.fn()}},
  };
  vi.stubGlobal('chrome',api);
  return {api,local,session,get tabs(){return tabs;},get groups(){return groups;},setTabs:(items:Tab[])=>{tabs=items;cleanup();},setGroups:(items:Group[])=>{groups=items;}};
}
