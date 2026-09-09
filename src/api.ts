import type { Session } from '../shared/types';
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function request<T>(path:string,session:Session|null,data?:unknown):Promise<T> {
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const result=await response.json();
  if(!response.ok) throw new ApiError(response.status,result.error??'请求失败，请重试');
  return result as T;
}
export function loadSession():Session|null {
  try {const value=JSON.parse(localStorage.getItem('guandan.session')??'null');return value && typeof value.token==='string' && typeof value.nickname==='string'?value:null;}catch{return null;}
}
export const roomKey='guandan.room';
