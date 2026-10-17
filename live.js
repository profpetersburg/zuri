// Live layer: swaps the demo's fake rates, KYC and sending for real API calls.
(function(){
var TK=null;try{TK=localStorage.getItem('zuri-token')}catch(e){}
function api(p,o){o=o||{};o.headers=Object.assign({'Content-Type':'application/json',Authorization:'Bearer '+TK},o.headers||{});
 return fetch(p,o).then(function(r){return r.json().then(function(j){if(!r.ok){if(r.status==401){TK=null;login()}throw new Error(j.error||'Request failed')}return j})})}
var LV={};Object.keys(DEST).forEach(function(k){LV[k]=Object.assign({},DEST[k].r);Object.keys(SYM).forEach(function(c){
 Object.defineProperty(DEST[k].r,c,{get:function(){return LV[k][c]},set:function(){},enumerable:true,configurable:true})})}); // pin: ignore the demo's random drift
function rates(){return api('/api/rates').then(function(j){Object.keys(j.rates).forEach(function(k){if(LV[k])Object.assign(LV[k],j.rates[k])});if(S.tab=='send'&&S.step=='amount'&&$('out'))upd()}).catch(function(e){toast(e.message)})}
function login(){var o=document.createElement('div');o.style.cssText='position:fixed;inset:0;background:var(--bg);z-index:20;display:flex;align-items:center;justify-content:center;padding:24px';
 o.innerHTML='<div class="card f" style="width:100%;max-width:380px"><h2>Sign in to Zuri</h2><label for="le">Email</label><input id="le" type="email" autocomplete="email"><div class="err" id="lerr"></div><button class="btn" id="lb">Continue</button></div>';
 document.body.appendChild(o);$('lb').onclick=function(){fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('le').value})}).then(function(r){return r.json()}).then(function(j){
  if(!j.token){$('lerr').textContent=j.error||'Could not sign in';return}TK=j.token;try{localStorage.setItem('zuri-token',TK)}catch(e){}o.remove();boot()})}}
function boot(){rates();setInterval(rates,6e4);api('/api/me').then(function(m){S.kyc=m.kyc=='approved';save();render()})}
window.vKyc=function(){return '<h1>Verify your identity</h1><p style="color:var(--mute);margin:-8px 0 14px">Required once by law. Our regulated partner checks your ID and a selfie. We never see your card details.</p><div id="sns"></div><div class="err" id="ke"></div><button class="btn" id="kb" data-a="kyc">Start verification</button>'};
function kycPoll(){api('/api/me').then(function(m){if(m.kyc=='approved'){S.kyc=true;save();toast('Identity verified');S.step=S.rid?'review':'amount';render()}
 else if(m.kyc=='rejected'){$('ke').textContent='We could not verify you. Contact support.'}else setTimeout(kycPoll,2000)})}
function startKyc(b){b.disabled=true;api('/api/kyc/session',{method:'POST'}).then(function(s){if(s.mode=='sandbox')return kycPoll();
 var sc=document.createElement('script');sc.src='https://static.sumsub.com/idensic/static/sns-websdk-builder.js';sc.onload=function(){
  snsWebSdk.init(s.token,function(){return api('/api/kyc/session',{method:'POST'}).then(function(x){return x.token})}).withConf({lang:'en'}).withOptions({addViewportTag:false,adaptIframeHeight:true})
  .on('idCheck.onApplicantSubmitted',kycPoll).build().launch('#sns')};document.body.appendChild(sc);b.style.display='none'}).catch(function(e){b.disabled=false;$('ke').textContent=e.message})}
function track(t0){var t={rid:S.rid,cc:S.to,from:t0.from,amt:t0.amount,name:t0.name,cur:t0.cur,get:t0.get,tot:t0.total,sym:SYM[t0.from],p:0,done:false,ref:t0.id.slice(2,10).toUpperCase(),date:new Date(t0.at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}),sid:t0.id};
 S.txs.unshift(t);S.last=t;S.tab='send';S.step='done';save();render();
 (function poll(){api('/api/transfers/'+t.sid).then(function(s){t.p=s.status=='delivered'?3:s.status=='processing'?2:s.status=='awaiting_payment'?0:t.p;t.done=s.status=='delivered';save();
  if(S.step=='done'&&S.last===t)render();if(s.status=='refund_due'){toast('Payout failed. Your money will be refunded.')}else if(!t.done)setTimeout(poll,2500)})})()}
function sendReal(b){var r=S.recips.filter(function(x){return x.id==S.rid})[0],shown=calc().get;b.disabled=true;b.textContent='Locking rate…';
 api('/api/quotes',{method:'POST',body:JSON.stringify({from:S.from,to:S.to,amount:+S.amt})}).then(function(q){
  if(Math.abs(q.receive-shown)/shown>.003&&!confirm('The rate moved. '+r.name.split(' ')[0]+' will now receive '+fmt(q.receive,0)+' '+q.cur+'. Continue?')){b.disabled=false;b.textContent='Send';return}
  return api('/api/transfers',{method:'POST',body:JSON.stringify({quoteId:q.id,recipient:{name:r.name,acct:r.acct,method:r.method,bankCode:r.bankCode}})}).then(function(x){if(x.url)location.href=x.url;else track(x.transfer)})
 }).catch(function(e){b.disabled=false;b.textContent='Send';toast(e.message)})}
document.addEventListener('click',function(e){var b=e.target.closest('[data-a]');if(!b)return;
 if(b.dataset.a=='kyc'){e.stopImmediatePropagation();startKyc(b)}else if(b.dataset.a=='send'){e.stopImmediatePropagation();sendReal(b)}},true);
var pd=new URLSearchParams(location.search).get('paid');
if(TK){boot();if(pd)api('/api/transfers/'+pd).then(function(t){history.replaceState(0,'','/');if(!S.txs.some(function(x){return x.sid==t.id}))track(t)})}else login();
})();
