import "dotenv/config";
import express from "express";
import http from "http";
import session from "express-session";
import mongoose from "mongoose";
import { Server } from "socket.io";
import crypto from "crypto";

const app=express();
const httpServer=http.createServer(app);
const io=new Server(httpServer);
const PORT=Number(process.env.PORT||3000);
const APP_URL=process.env.APP_URL||`http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret:process.env.SESSION_SECRET||"change-this-secret",
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*60*60*1000}
}));
app.use(express.static("public"));

const chars=[
["Ava","female","long","black","blue","light",0,0,1,"none"],
["Liam","male","short","brown","brown","light",1,0,0,"beard"],
["Mia","female","bob","blonde","green","light",0,0,1,"none"],
["Noah","male","curly","black","brown","medium",0,1,0,"mustache"],
["Zoe","female","long","red","green","light",1,0,0,"none"],
["Ethan","male","spiky","blonde","blue","medium",0,0,0,"beard"],
["Luna","female","short","brown","brown","dark",0,1,1,"none"],
["Leo","male","wavy","black","green","medium",1,0,0,"none"],
["Emma","female","curly","brown","blue","light",0,0,0,"none"],
["Oliver","male","long","red","brown","medium",0,1,0,"beard"],
["Ruby","female","bob","black","green","dark",0,0,1,"none"],
["James","male","short","blonde","blue","light",1,0,0,"mustache"],
["Ivy","female","long","brown","brown","medium",0,0,0,"none"],
["Henry","male","curly","red","green","light",0,1,0,"beard"],
["Ella","female","wavy","blonde","blue","light",1,0,0,"none"],
["Jack","male","spiky","black","brown","dark",0,0,0,"none"],
["Nora","female","short","red","green","medium",0,1,1,"none"],
["Lucas","male","wavy","brown","blue","medium",1,0,0,"beard"],
["Chloe","female","curly","black","brown","dark",0,0,0,"none"],
["Mason","male","short","brown","green","light",0,0,0,"mustache"],
["Aria","female","long","blonde","blue","medium",0,1,0,"none"],
["Logan","male","curly","blonde","brown","light",1,0,0,"beard"],
["Layla","female","bob","red","green","light",0,0,1,"none"],
["Ben","male","spiky","brown","blue","dark",0,0,0,"none"],
["Sara","female","wavy","black","brown","medium",1,1,0,"none"],
["Daniel","male","short","red","green","medium",0,0,0,"beard"],
["Nina","female","curly","brown","blue","dark",0,0,0,"none"],
["Adam","male","long","blonde","brown","light",0,1,0,"mustache"],
["Maya","female","short","black","green","medium",1,0,1,"none"],
["Ryan","male","wavy","red","blue","light",0,0,0,"beard"]
].map((x,i)=>({id:i+1,name:x[0],gender:x[1],hairStyle:x[2],hairColor:x[3],eyes:x[4],skin:x[5],glasses:!!x[6],headwear:!!x[7],jewelry:!!x[8],facialHair:x[9]}));

const CATS={
 gender:{label:"Gender",values:["male","female"]},
 eyes:{label:"Eye Color",values:["blue","brown","green"]},
 hairStyle:{label:"Hair",values:["short","long","curly","bob","wavy","spiky"]},
 hairColor:{label:"Hair Color",values:["black","brown","blonde","red"]},
 skin:{label:"Skin Tone",values:["light","medium","dark"]},
 glasses:{label:"Glasses",values:["yes","no"]},
 headwear:{label:"Headwear",values:["yes","no"]},
 jewelry:{label:"Accessories",values:["yes","no"]},
 facialHair:{label:"Facial Hair",values:["none","beard","mustache"]}
};

const sessions=new Map(); // connected users
const queues=[];
const invites=new Map();
const rooms=new Map();

let User=null;
if(process.env.MONGODB_URI){
  await mongoose.connect(process.env.MONGODB_URI);
  const schema=new mongoose.Schema({
    discordId:{type:String,unique:true,index:true},username:String,avatar:String,
    games:{type:Number,default:0},wins:{type:Number,default:0},losses:{type:Number,default:0},
    questions:{type:Number,default:0},correctGuesses:{type:Number,default:0},wrongGuesses:{type:Number,default:0},
    createdAt:{type:Date,default:Date.now},lastSeen:Date
  });
  User=mongoose.model("GCUser",schema);
}

function id(){return crypto.randomUUID()}
function connectedUsers(){
  return [...sessions.values()].map(x=>({id:x.id,username:x.username,avatar:x.avatar}));
}
function socketsOf(uid){return [...sessions.values()].filter(x=>x.id===uid).map(x=>x.socketId)}
function emitUser(uid,event,data){for(const sid of socketsOf(uid))io.to(sid).emit(event,data)}
function roomOf(uid){for(const r of rooms.values())if(r.players.some(p=>p.uid===uid))return r}
function player(r,uid){return r.players.find(p=>p.uid===uid)}
function opponent(r,uid){return r.players.find(p=>p.uid!==uid)}
function value(c,cat){let v=c[cat]; if(["glasses","headwear","jewelry"].includes(cat))return v?"yes":"no";return v}
function publicRoom(r,uid){
 const me=player(r,uid),op=opponent(r,uid);
 return {
  id:r.id,status:r.status,turnUid:r.players[r.turn]?.uid||null,
  me:{id:me.uid,username:me.username,avatar:me.avatar,secretSelected:me.secret!==null,secretId:me.secret,
      eliminated:[...me.elim],used:[...me.used],remaining:chars.length-me.elim.size},
  opponent:op?{id:op.uid,username:op.username,avatar:op.avatar,secretSelected:op.secret!==null,
      eliminatedCount:op.elim.size,remaining:chars.length-op.elim.size}:null,
  history:r.history,winner:r.winner||null,startedAt:r.startedAt||null
 };
}
function sync(r){for(const p of r.players)emitUser(p.uid,"game:state",publicRoom(r,p.uid))}
function online(){io.emit("lobby:online",connectedUsers())}

async function stat(uid,inc){
 if(User) await User.updateOne({discordId:uid},{$inc:inc,$set:{lastSeen:new Date()}},{upsert:true});
}

app.get("/api/config",(req,res)=>res.json({characters:chars,categories:CATS}));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));
app.get("/api/leaderboard",async(req,res)=>{
 if(!User)return res.json([]);
 const a=await User.find({}).sort({wins:-1,games:-1,correctGuesses:-1}).limit(100).lean();
 res.json(a.map(x=>({username:x.username,avatar:x.avatar,wins:x.wins,games:x.games,losses:x.losses,
   questions:x.questions,correctGuesses:x.correctGuesses,winRate:x.games?Math.round(x.wins/x.games*100):0})));
});
app.get("/api/stats",async(req,res)=>{
 if(!req.session.user||!User)return res.json(null);
 const x=await User.findOne({discordId:req.session.user.id}).lean();
 res.json(x?{games:x.games,wins:x.wins,losses:x.losses,questions:x.questions,correctGuesses:x.correctGuesses,
   wrongGuesses:x.wrongGuesses,winRate:x.games?Math.round(x.wins/x.games*100):0}:null);
});

/* Discord OAuth2 */
app.get("/auth/discord",(req,res)=>{
 const client=process.env.DISCORD_CLIENT_ID;
 if(!client)return res.status(500).send("DISCORD_CLIENT_ID is not configured.");
 const redirect=process.env.DISCORD_REDIRECT_URI||`${APP_URL}/auth/discord/callback`;
 const u=new URL("https://discord.com/oauth2/authorize");
 u.searchParams.set("client_id",client);u.searchParams.set("response_type","code");
 u.searchParams.set("redirect_uri",redirect);u.searchParams.set("scope","identify");
 res.redirect(u.toString());
});
app.get("/auth/discord/callback",async(req,res)=>{
 try{
  if(!req.query.code)return res.redirect("/?error=oauth");
  const redirect=process.env.DISCORD_REDIRECT_URI||`${APP_URL}/auth/discord/callback`;
  const body=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,
    grant_type:"authorization_code",code:String(req.query.code),redirect_uri:redirect});
  const token=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}).then(x=>x.json());
  if(!token.access_token)throw new Error("Discord token exchange failed");
  const me=await fetch("https://discord.com/api/users/@me",{headers:{Authorization:`Bearer ${token.access_token}`}}).then(x=>x.json());
  const user={id:me.id,username:me.global_name||me.username,avatar:me.avatar?`https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128`:""};
  req.session.user=user;
  if(User)await User.updateOne({discordId:user.id},{$set:{username:user.username,avatar:user.avatar,lastSeen:new Date()}},{upsert:true});
  res.redirect("/");
 }catch(e){console.error(e);res.status(500).send("Discord login failed. Check your OAuth settings.");}
});
app.get("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/")));

io.use((socket,next)=>{
 if(!socket.request.session?.user)return next(new Error("LOGIN_REQUIRED"));
 next();
});

io.on("connection",socket=>{
 const u=socket.request.session.user;
 sessions.set(socket.id,{id:u.id,username:u.username,avatar:u.avatar||"",socketId:socket.id});
 online();

 socket.emit("lobby:online",connectedUsers());
 const existing=roomOf(u.id);if(existing)socket.emit("game:state",publicRoom(existing,u.id));

 socket.on("lobby:refresh",()=>socket.emit("lobby:online",connectedUsers()));

 socket.on("invite:send",({to})=>{
  if(!to||to===u.id||!sessionsHas(to))return;
  const inv={id:id(),from:u.id,to,fromUser:{id:u.id,username:u.username,avatar:u.avatar||""},created:Date.now()};
  invites.set(inv.id,inv);emitUser(to,"invite:received",inv);
 });
 socket.on("invite:decline",({inviteId})=>invites.delete(inviteId));
 socket.on("invite:accept",({inviteId})=>{
  const inv=invites.get(inviteId);if(!inv||inv.to!==u.id)return;
  invites.delete(inviteId);if(roomOf(u.id)||roomOf(inv.from))return;
  createRoom(inv.from,u.id);
 });

 socket.on("match:join",()=>{
  if(roomOf(u.id))return;
  const idx=queues.findIndex(x=>x!==u.id&&sessionsHas(x));
  if(idx>=0){const otherUid=queues.splice(idx,1)[0];if(!roomOf(otherUid))createRoom(otherUid,u.id);else socket.emit("match:searching")}
  else{if(!queues.includes(u.id))queues.push(u.id);socket.emit("match:searching")}
 });
 socket.on("match:leave",()=>{const i=queues.indexOf(u.id);if(i>=0)queues.splice(i,1);socket.emit("match:left")});

 socket.on("game:secret",({characterId})=>{
  const r=roomOf(u.id);if(!r||r.status!=="selecting")return;
  const p=player(r,u.id),n=Number(characterId);
  if(p.secret!==null||!chars.some(c=>c.id===n)||r.players.some(x=>x.secret===n))return;
  p.secret=n;if(r.players.every(x=>x.secret!==null)){r.status="playing";r.startedAt=Date.now()}
  sync(r);
 });

 socket.on("game:ask",async({category,value:askedValue})=>{
  const r=roomOf(u.id);if(!r||r.status!=="playing"||r.players[r.turn].uid!==u.id)return;
  const p=player(r,u.id),op=opponent(r,u.id);
  if(!CATS[category]||p.used.has(category))return;
  const v=String(askedValue);
  if(!CATS[category].values.includes(v))return;
  p.used.add(category);
  const target=chars.find(c=>c.id===op.secret);
  const answer=String(value(target,category))===v;
  r.history.push({type:"question",uid:u.id,username:u.username,category,value:v,answer,at:Date.now()});
  await stat(u.id,{questions:1});
  r.turn=1-r.turn;sync(r);
 });

 socket.on("game:guess",async({characterId})=>{
  const r=roomOf(u.id);if(!r||r.status!=="playing"||r.players[r.turn].uid!==u.id)return;
  const p=player(r,u.id),op=opponent(r,u.id),n=Number(characterId);
  if(!chars.some(c=>c.id===n)||p.elim.has(n))return;
  if(n===op.secret){
   r.status="finished";r.winner=u.id;
   r.history.push({type:"guess",uid:u.id,username:u.username,characterId:n,correct:true,at:Date.now()});
   await stat(u.id,{games:1,wins:1,correctGuesses:1});await stat(op.uid,{games:1,losses:1});
  }else{
   p.elim.add(n);
   r.history.push({type:"guess",uid:u.id,username:u.username,characterId:n,correct:false,at:Date.now()});
   await stat(u.id,{wrongGuesses:1});r.turn=1-r.turn;
  }
  sync(r);
 });

 socket.on("game:rematch",()=>{
  const r=roomOf(u.id);if(!r||r.status!=="finished")return;
  const ids=r.players.map(p=>p.uid);rooms.delete(r.id);
  if(ids.every(sessionsHas))createRoom(ids[0],ids[1]);
 });

 socket.on("game:leave",()=>leaveGame(u.id));

 socket.on("disconnect",()=>{
  sessions.delete(socket.id);
  online();
  if(!sessionsHas(u.id)){
   const qi=queues.indexOf(u.id);if(qi>=0)queues.splice(qi,1);
   const r=roomOf(u.id);if(r)leaveGame(u.id,true);
  }
 });
});

function sessionsHas(uid){for(const x of sessions.values())if(x.id===uid)return true;return false}
function pdata(uid){
 const x=[...sessions.values()].find(z=>z.id===uid);
 return x||{id:uid,username:"Player",avatar:""};
}
function createRoom(a,b){
 if(roomOf(a)||roomOf(b))return;
 const pa=pdata(a),pb=pdata(b);
 const r={id:id(),players:[
  {uid:a,username:pa.username,avatar:pa.avatar,secret:null,elim:new Set(),used:new Set()},
  {uid:b,username:pb.username,avatar:pb.avatar,secret:null,elim:new Set(),used:new Set()}
 ],turn:0,status:"selecting",history:[],winner:null,startedAt:null};
 rooms.set(r.id,r);sync(r);
}
function leaveGame(uid,disconnect=false){
 const r=roomOf(uid);if(!r)return;
 const op=opponent(r,uid);rooms.delete(r.id);
 if(op)emitUser(op.uid,"game:opponentLeft",{username:pdata(uid).username,disconnect});
 emitUser(uid,"game:state",null);
}

app.get("*",(req,res)=>res.sendFile(process.cwd()+"/public/index.html"));
httpServer.listen(PORT,()=>console.log(`Guess Character PvP running on ${APP_URL}`));
