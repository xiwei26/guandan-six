import { client } from './services/client';
App({
  onLaunch() { client().server(); },
  onError(error: string) { console.error('小程序运行错误', error); }
});
