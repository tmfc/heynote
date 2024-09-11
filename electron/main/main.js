import { ipcMain } from 'electron';
import { Buffer } from './couchBuffer';

const buffer = new Buffer({ onChange: (content) => {
    // 处理内容变化
}});

