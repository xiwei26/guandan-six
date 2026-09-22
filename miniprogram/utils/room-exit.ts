import type { RoomView } from '../shared/types';

type ExitRoom = Pick<RoomView,'mode'|'status'>;
export const canLeaveCompletely=(room:ExitRoom)=>room.mode==='computer'||room.status==='waiting'||room.status==='finished';
export function leaveMessage(room:ExitRoom|null):string {
  if(!room)return '等待中或已结束的房间会让出座位；电脑局由电脑接替，进行中的好友局保留座位。';
  if(room.status==='waiting'||room.status==='finished')return '离开将让出座位。';
  if(room.mode==='computer')return '退出后由电脑接替，不能返回原座位；可以创建或加入新房间。';
  return '牌局继续，座位会保留。下次可从大厅返回本房间，结束前不能加入其他房间。';
}
