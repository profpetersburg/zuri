// Zuri backend. Zero dependencies, Node 22+. MODE=sandbox (default, fake providers) or MODE=live.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const E=process.env,LIVE=E.MODE==='live',PORT=E.PORT||3000,DB_FILE=E.DB_FILE||'data.json';
const MARGIN=+(E.FX_MARGIN||0.005),LIMIT=+(E.PER_TRANSFER_LIMIT||5000),DAILY=+(E.DAILY_LIMIT||10000);
const SECRET=E.JWT_SECRET||'dev-secret-change-me',BASE=E.BASE_URL||'http://localhost:'+PORT;
if(LIVE&&SECRET==='dev-secret-change-me')throw new Error('Set JWT_SECRET');
const COUNTRIES={KE:'KES',NG:'NGN',GH:'GHS',UG:'UGX',TZ:'TZS',RW:'RWF',SN:'XOF',ET:'ETB'},SRC=['GBP','USD','EUR'];
const db=fs.existsSync(DB_FILE)?JSON.parse(fs.readFileSync(DB_FILE)):{users:{},quotes:{},transfers:{},ledger:[]};
const save=()=>fs.writeFileSync(DB_FILE,JSON.stringify(db));
const id=p=>p+'_'+crypto.randomBytes(8).toString('hex');
const led=(t,type)=>{db.ledger.push({id:id('le'),transfer:t.id,type,amount:t.amount,from:t.from,at:new Date().toISOString()});save()};
const hmac=(k,d,enc='hex')=>crypto.createHmac('sha256',k).update(d).digest(enc);
const same=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
// ---- auth (HS256 JWT). Replace login with your IdP (Auth0/Clerk/Firebase) before going live.
const b64=s=>Buffer.from(s).toString('base64url');
const sign=p=>{const h=b64('{"alg":"HS256","typ":"JWT"}'),d=b64(JSON.stringify(p));return h+'.'+d+'.'+hmac(SECRET,h+'.'+d,'base64url')};
const verify=t=>{const[a,b,c]=(t||'').split('.');if(!c||!same(hmac(SECRET,a+'.'+b,'base64url'),c))return null;const p=JSON.parse(Buffer.from(b,'base64url'));return p.exp>Date.now()/1e3?p:null};
// ---- providers
let cache={at:0,r:null};
async function usdRates(){if(Date.now()-cache.at<6e4)return cache.r;
 const r=LIVE?(await(await fetch('https://openexchangerates.org/api/latest.json?app_id='+E.OXR_APP_ID)).json()).rates
  :{USD:1,GBP:.79,EUR:.92,KES:129,NGN:1550,GHS:14.6,UGX:3650,TZS:2600,RWF:1350,XOF:605,ETB:125};
 if(!r||!r.USD)throw new Error('rates unavailable');cache={at:Date.now(),r};return r}
const cross=(r,f,t)=>r[t]/r[f]*(1-MARGIN);
const sumsub=async(m,u,body)=>{const ts=Math.floor(Date.now()/1e3);return(await fetch('https://api.sumsub.com'+u,{method:m,body,headers:{'X-App-Token':E.SUMSUB_TOKEN,'X-App-Access-Sig':hmac(E.SUMSUB_SECRET,ts+m+u+(body||'')),'X-App-Access-Ts':ts,'Content-Type':'application/json'}})).json()};
const form=o=>new URLSearchParams(o);
async function collect(t){ // returns {url} to redirect the customer to pay
 if(!LIVE){setTimeout(()=>onPaid(t.id),1200);return{url:null}}
 const r=await(await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+E.STRIPE_SECRET,'Idempotency-Key':t.id},
  body:form({mode:'payment','line_items[0][quantity]':1,'line_items[0][price_data][currency]':t.from.toLowerCase(),'line_items[0][price_data][unit_amount]':t.totalMinor,
  'line_items[0][price_data][product_data][name]':'Transfer to '+t.recipient.name,success_url:BASE+'/?paid='+t.id,cancel_url:BASE+'/','metadata[transferId]':t.id,'payment_intent_data[metadata][transferId]':t.id})})).json();
 if(!r.url)throw new Error('payment provider error');return{url:r.url}}
async function payout(t){
 if(!LIVE){setTimeout(()=>onPayout(t.id,true),3000);return}
 const x=t.recipient,r=await(await fetch('https://api.flutterwave.com/v3/transfers',{method:'POST',headers:{Authorization:'Bearer '+E.FLW_SECRET,'Content-Type':'application/json'},
  body:JSON.stringify({account_bank:x.bankCode,account_number:x.acct,amount:t.receive,currency:t.cur,reference:t.id,beneficiary_name:x.name,narration:'Zuri transfer',callback_url:BASE+'/webhooks/payout'})})).json();
 if(r.status!=='success')onPayout(t.id,false)}
// ---- transfer state machine
function onPaid(tid){const t=db.transfers[tid];if(!t||t.status!=='awaiting_payment')return;t.status='processing';led(t,'collected');save();
 payout(t).catch(()=>onPayout(tid,false))}
function onPayout(tid,ok){const t=db.transfers[tid];if(!t||t.status!=='processing')return;t.status=ok?'delivered':'refund_due';led(t,ok?'paid_out':'refund_due');save()}
const pub=t=>({id:t.id,status:t.status,name:t.recipient.name,cur:t.cur,get:t.receive,from:t.from,amount:t.amount,total:t.total,at:t.at});
// ---- http
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
const raw=req=>new Promise((ok,no)=>{let b='';req.on('data',d=>{b+=d;if(b.length>1e6)req.destroy()});req.on('end',()=>ok(b));req.on('error',no)});
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,BASE),p=u.pathname,body=req.method==='POST'?await raw(req):'';
 if(p==='/webhooks/payment'){const s=Object.fromEntries((req.headers['stripe-signature']||'').split(',').map(x=>x.split('=')));
  if(!s.t||!s.v1||Math.abs(Date.now()/1e3-s.t)>300||!same(hmac(E.STRIPE_WHSEC||'x',s.t+'.'+body),s.v1))return send(res,400,{error:'bad signature'});
  const ev=JSON.parse(body);if(ev.type==='checkout.session.completed'&&ev.data.object.payment_status==='paid')onPaid(ev.data.object.metadata.transferId);return send(res,200,{ok:1})}
 if(p==='/webhooks/payout'){if(!same(req.headers['verif-hash']||'',E.FLW_HASH||'x'))return send(res,401,{error:'bad hash'});
  const d=JSON.parse(body).data||{};if(d.status)onPayout(d.reference,d.status==='SUCCESSFUL');return send(res,200,{ok:1})}
 if(p==='/webhooks/kyc'){if(!same(req.headers['x-payload-digest']||'',hmac(E.SUMSUB_WEBHOOK_SECRET||'x',body)))return send(res,401,{error:'bad digest'});
  const ev=JSON.parse(body),uu=db.users[ev.externalUserId];if(uu&&ev.type==='applicantReviewed'){uu.kyc=ev.reviewResult.reviewAnswer==='GREEN'?'approved':'rejected';save()}return send(res,200,{ok:1})}
 if(p==='/api/config')return send(res,200,{mode:LIVE?'live':'sandbox'});
 if(p==='/api/login'&&req.method==='POST'){if(LIVE)return send(res,501,{error:'Connect your identity provider'});
  const em=String(JSON.parse(body).email||'').toLowerCase();if(!/^\S+@\S+\.\S+$/.test(em))return send(res,400,{error:'Enter a valid email'});
  const uid='u_'+hmac('id',em).slice(0,12);db.users[uid]=db.users[uid]||{id:uid,email:em,kyc:'none'};save();return send(res,200,{token:sign({sub:uid,exp:Date.now()/1e3+86400})})}
 if(p.startsWith('/api/')){
  const au=verify((req.headers.authorization||'').slice(7)),me=au&&db.users[au.sub];if(!me)return send(res,401,{error:'Sign in required'});
  if(p==='/api/me')return send(res,200,{email:me.email,kyc:me.kyc});
  if(p==='/api/rates'){const r=await usdRates(),o={};for(const[k,c]of Object.entries(COUNTRIES)){o[k]={};SRC.forEach(f=>o[k][f]=cross(r,f,c))}return send(res,200,{rates:o,at:cache.at})}
  if(p==='/api/kyc/session'&&req.method==='POST'){
   if(!LIVE){me.kyc='pending';save();setTimeout(()=>{me.kyc='approved';save()},1500);return send(res,200,{mode:'sandbox'})}
   const s=await sumsub('POST','/resources/accessTokens/sdk',JSON.stringify({userId:me.id,levelName:E.SUMSUB_LEVEL||'basic-kyc-level',ttlInSecs:600}));me.kyc='pending';save();return send(res,200,{mode:'live',token:s.token})}
  if(p==='/api/quotes'&&req.method==='POST'){const b=JSON.parse(body),a=+b.amount;
   if(!COUNTRIES[b.to]||!SRC.includes(b.from)||!(a>=1&&a<=LIMIT))return send(res,400,{error:'Amount must be 1 to '+LIMIT});
   const fee=Math.max(.99,a*.005),rate=cross(await usdRates(),b.from,COUNTRIES[b.to]),q={id:id('q'),user:me.id,from:b.from,to:b.to,cur:COUNTRIES[b.to],amount:a,fee:+fee.toFixed(2),rate,receive:Math.floor(a*rate),total:+(a+fee).toFixed(2),exp:Date.now()+6e5};
   db.quotes[q.id]=q;save();return send(res,200,q)}
  if(p==='/api/transfers'&&req.method==='POST'){
   if(me.kyc!=='approved')return send(res,403,{error:'Verify your identity first'});
   const b=JSON.parse(body),q=db.quotes[b.quoteId],x=b.recipient||{};
   if(!q||q.user!==me.id||q.used||q.exp<Date.now())return send(res,409,{error:'Quote expired. Please refresh the rate.'});
   if(!x.name||!x.acct||(LIVE&&!x.bankCode))return send(res,400,{error:'Recipient details incomplete'});
   const day=new Date().toISOString().slice(0,10),spent=Object.values(db.transfers).filter(t=>t.user===me.id&&t.at.startsWith(day)&&t.status!=='failed').reduce((s,t)=>s+t.amount,0);
   if(spent+q.amount>DAILY)return send(res,429,{error:'Daily limit reached'});
   // TODO(live): sanctions/PEP screening of sender + recipient here (ComplyAdvantage, Sumsub AML) before collecting funds.
   q.used=true;const t={id:id('t'),user:me.id,...q,recipient:{name:String(x.name).slice(0,80),acct:String(x.acct).slice(0,40),bankCode:x.bankCode,method:x.method},totalMinor:Math.round(q.total*100),status:'awaiting_payment',at:new Date().toISOString()};
   db.transfers[t.id]=t;save();const c=await collect(t);return send(res,201,{transfer:pub(t),url:c.url})}
  if(p==='/api/transfers'&&req.method==='GET')return send(res,200,Object.values(db.transfers).filter(t=>t.user===me.id).map(pub));
  const m=p.match(/^\/api\/transfers\/(\w+)$/);if(m){const t=db.transfers[m[1]];return t&&t.user===me.id?send(res,200,pub(t)):send(res,404,{error:'Not found'})}
  return send(res,404,{error:'Not found'})}
 const f=path.join(__dirname,'public',p==='/'?'index.html':p.replace(/\.\./g,''));
 if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(res)}
 send(res,404,{error:'Not found'})}catch(e){console.error(e);send(res,500,{error:'Something went wrong'})}}).listen(PORT,()=>console.log('Zuri '+(LIVE?'LIVE':'sandbox')+' on '+BASE));
