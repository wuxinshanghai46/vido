import { api } from '../core/api-client.js';
import { mountShell,toast } from '../core/page-shell.js';
mountShell('设置');const form=document.getElementById('settings-form');try{const data=await api('/settings');for(const [key,value] of Object.entries(data.settings||{}))if(form.elements[key])form.elements[key].value=value}catch(e){toast(e.message,'error')}
form.onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(form));body.maxCostUsd=Number(body.maxCostUsd);body.autoRetry=Number(body.autoRetry);body.concurrency=Number(body.concurrency);try{await api('/settings',{method:'PUT',body});toast('画布设置已保存','success')}catch(error){toast(error.message,'error')}};
