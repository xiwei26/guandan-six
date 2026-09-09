import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:3001','/ws':{target:'ws://127.0.0.1:3001',ws:true}},fs:{deny:['.env','.env.*','**/.git/**','**/data/**','**/server/**','**/tests/**','**/.npm-cache/**']}},build:{outDir:'dist'}});
