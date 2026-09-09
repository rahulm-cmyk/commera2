import { MessageChannel,Worker,receiveMessageOnPort } from 'node:worker_threads';

export class PostgresSyncDatabase{
  constructor(connectionString){
    const {port1,port2}=new MessageChannel();
    this.port=port1;
    this.worker=new Worker(new URL('./postgres-sync-worker.js',import.meta.url),{workerData:{connectionString,port:port2},transferList:[port2]});
    this.exec('SELECT 1');
  }
  #query(mode,sql,params=[]){
    const signal=new Int32Array(new SharedArrayBuffer(4));
    this.port.postMessage({mode,sql,params,signal:signal.buffer});
    const state=Atomics.wait(signal,0,0,30_000);
    if(state==='timed-out')throw Error('PostgreSQL query timed out');
    const message=receiveMessageOnPort(this.port)?.message;
    if(!message)throw Error('PostgreSQL worker returned no response');
    if(!message.ok){const error=Error(message.error.message);error.code=message.error.code;throw error;}
    return message.data;
  }
  prepare(sql){return{get:(...params)=>this.#query('get',sql,params),all:(...params)=>this.#query('all',sql,params),run:(...params)=>this.#query('run',sql,params)};}
  exec(sql){return this.#query('exec',sql);}
  close(){this.port.close();return this.worker.terminate();}
}

