import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Server } from "socket.io";

const app=express();
const server=http.createServer(app);
const FRONTEND_URL=(process.env.FRONTEND_URL||"http://localhost:5500").replace(/\/$/,"");
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"change-me-in-production";
const API_URL=(process.env.BACKEND_URL||"").replace(/\/$/,"");

app.use(cors({origin:FRONTEND_URL,credentials:true}));
app.use(express.json({limit:"1mb"}));
app.get("/health",(req,res)=>res.json({ok:true,service:"guess-character-backend",time:new Date().toISOString()}));

const userSchema=new mongoose.Schema({
  discordId:{type:String,unique:true,sparse:true},
  username:String,displayName:String,avatar:String,
  demo:{type:Boolean,default:false},
  wins:{type:Number,default:0},losses:{type:Number,default:0},games:{type:Number,default:0},
  createdAt:{type:Date,default:Date.now},lastSeen:{type:Date,default:Date.now}
});
const User=mongoose.model("User",userSchema);

let dbReady=false;
if(process.env.MONGODB_URI){
  try{await mongoose.connect(process.env.MONGODB_URI);dbReady=true;console.log("MongoDB connected");}
  catch(e){console.error("MongoDB connection failed:",e.message);console.warn("Running with in-memory persistence.");}
}else console.warn("MONGODB_URI missing; running with in-memory persistence.");

const memoryUsers=new Map();
function memoryUser(id,data={}){if(!memoryUsers.has(id))memoryUsers.set(id,{id,username:data.username||"Player",displayName:data.displayName||"Player",avatar:data.avatar||"",wins:0,losses:0,games:0,demo:!!data.demo});return memoryUsers.get(id)}
async function getUser(id){
  if(dbReady){const u=await User.findById(id);if(u)return u}
  return memoryUsers.get(id)||null;
}
async function upsertDiscord(profile){
  if(dbReady){
    let u=await User.findOne({discordId:profile.id});
    if(!u)u=await User.create({discordId:profile.id,username:profile.username,displayName:profile.global_name||profile.username,avatar:profile.avatar||""});
    else {u.username=profile.username;u.displayName=profile.global_name||profile.username;u.avatar=profile.avatar||"";u.lastSeen=new Date();await u.save();}
    return u;
  }
  return memoryUser(`d_${profile.id}`,{username:profile.username,displayName:profile.global_name||profile.username,avatar:profile.avatar||""});
}
function publicUser(u,idOverride=null){return {id:idOverride||u._id?.toString()||u.id,username:u.username,displayName:u.displayName||u.username,avatar:u.avatar||"",wins:u.wins||0,losses:u.losses||0}}
function sign(u){return jwt.sign({sub:u._id?.toString()||u.id,username:u.username,displayName:u.displayName,demo:!!u.demo},JWT_SECRET,{expiresIn:"7d"})}
async function auth(req,res,next){
  try{const h=req.headers.authorization||"";const t=h.startsWith("Bearer ")?h.slice(7):null;if(!t)throw Error("Missing token");const p=jwt.verify(t,JWT_SECRET);const u=await getUser(p.sub);if(!u)throw Error("User not found");req.user=u;req.userId=p.sub;next()}catch(e){res.status(401).json({error:"Authentication required"})}
}
function socketAuth(socket,next){
  try{const t=socket.handshake.auth?.token;if(!t)throw Error();socket.user=jwt.verify(t,JWT_SECRET);next()}catch{next(new Error("Unauthorized"))}
}

const categories=[
  {id:"gender",label:"Gender",icon:"⚧",example:"Is the character male?"},
  {id:"eyes",label:"Eye Color",icon:"👁",example:"Do they have blue eyes?"},
  {id:"hairStyle",label:"Hair",icon:"💇",example:"Do they have curly hair?"},
  {id:"hairColor",label:"Hair Color",icon:"🎨",example:"Is their hair black?"},
  {id:"skin",label:"Skin Tone",icon:"🖐",example:"Do they have a light tone?"},
  {id:"glasses",label:"Glasses",icon:"👓",example:"Are they wearing glasses?"},
  {id:"headwear",label:"Headwear",icon:"🎩",example:"Are they wearing a hat?"},
  {id:"jewelry",label:"Accessories",icon:"💎",example:"Do they wear jewelry?"},
  {id:"facialHair",label:"Facial Hair",icon:"🧔",example:"Do they have facial hair?"}
];

const characters=[
["Alex","M","short","black","brown","medium",false,false,false,true,"😎"],["Maya","F","long","brown","green","light",false,false,true,false,"👩🏻"],
["Leo","M","curly","blonde","blue","light",true,false,false,false,"👨🏼"],["Nora","F","bob","black","brown","dark",false,true,false,false,"👩🏿"],
["Ryan","M","long","red","green","medium",false,true,false,true,"🧑🏻‍🦰"],["Zara","F","curly","brown","blue","medium",true,false,true,false,"👩🏽"],
["Ethan","M","short","blonde","brown","light",false,false,false,true,"👱🏻"],["Luna","F","long","black","green","dark",false,false,true,false,"👩🏾"],
["Noah","M","bob","brown","blue","medium",true,true,false,false,"🧑🏽"],["Ava","F","short","red","brown","light",false,false,false,false,"👩🏻‍🦰"],
["Kai","M","curly","black","green","dark",false,true,true,true,"🧔🏿"],["Ivy","F","long","blonde","blue","medium",false,false,true,false,"👱🏼"],
["Owen","M","short","brown","brown","dark",true,false,false,true,"👨🏿"],["Mia","F","bob","red","green","light",false,true,false,false,"👩🏻‍🦰"],
["Adam","M","long","black","blue","medium",false,false,false,true,"👨🏽"],["Ella","F","curly","brown","brown","dark",true,false,true,false,"👩🏿"],
["Finn","M","bob","blonde","green","light",false,true,false,false,"👱🏻"],["Sia","F","short","black","blue","medium",false,false,true,false,"👩🏽"],
["Liam","M","curly","red","brown","light",true,true,false,true,"🧔🏻‍🦰"],["Zoe","F","long","brown","green","dark",false,false,false,false,"👩🏿"],
["Max","M","short","black","blue","medium",false,true,false,true,"🧔🏽"],["Aria","F","bob","blonde","brown","light",true,false,true,false,"👱🏻"],
["Ben","M","long","brown","green","dark",false,false,false,true,"👨🏿"],["Nia","F","curly","red","blue","medium",false,true,true,false,"👩🏽‍🦰"],
["Sam","M","short","blonde","brown","light",true,false,false,false,"👨🏼"],["Eva","F","long","black","green","dark",false,false,true,false,"👩🏿"],
["Jay","M","bob","red","blue","medium",false,true,false,true,"🧔🏽‍🦰"],["Lia","F","short","brown","brown","light",true,false,false,false,"👩🏻"],
["Cole","M","curly","black","green","dark",false,false,false,true,"🧔🏿"],["Ria","F","long","blonde","blue","medium",false,true,true,false,"👱🏽"]
].map((x,i)=>({id:String(i+1),name:x[0],gender:x[1],hairStyle:x[2],hairColor:x[3],eyes:x[4],skin:x[5],glasses:x[6],headwear:x[7],jewelry:x[8],facialHair:x[9],avatar:x[10],short:`${x[1]==="M"?"Male":"Female"} • ${x[3]} hair`}));

function safeCharacters(eliminated=[]){return characters.map(c=>({id:c.id,name:c.name,avatar:c.avatar,short:c.short,eliminated:eliminated.includes(c.id)}))}
const rooms=new Map();
const sockets=new Map();
const queue=[];
const invites=new Map();
const rematchWait=new Map();

function socketPlayers(){return [...sockets.entries()].map(([id,s])=>({id,displayName:s.displayName||"Player",avatar:s.avatar||"",status:s.roomId?"in-game":"online"}))}
function emitPlayers(){io.emit("players:update",socketPlayers())}
function categoryMatch(c,cat){
  if(cat==="gender")return c.gender==="M";
  if(cat==="eyes")return c.eyes==="blue";
  if(cat==="hairStyle")return c.hairStyle==="curly";
  if(cat==="hairColor")return c.hairColor==="black";
  if(cat==="skin")return c.skin==="light";
  if(cat==="glasses")return c.glasses;
  if(cat==="headwear")return c.headwear;
  if(cat==="jewelry")return c.jewelry;
  if(cat==="facialHair")return c.facialHair;
}
function stateFor(room,uid){
  const p=room.players[uid],opp=room.players[uid===room.a?room.b:room.a];
  const eliminated=p.eliminated;
  return {roomId:room.id,round:room.round,turn:room.turn,characters:safeCharacters(eliminated),categories:categories.map(c=>({id:c.id,label:c.label,icon:c.icon,example:c.example,used:p.used.has(c.id)})),opponent:{id:opp.id,displayName:opp.displayName},opponentRemaining:opp.eliminated.length?characters.length-opp.eliminated.length:characters.length,status:room.status};
}
function broadcastRoom(room){for(const uid of [room.a,room.b]){const s=sockets.get(uid);if(s)s.emit("game:state",stateFor(room,uid))}}
function findRoomByUser(uid){for(const r of rooms.values())if(r.a===uid||r.b===uid)return r;return null}
function makeRoom(a,b){
  const id=crypto.randomUUID();const secretA=characters[Math.floor(Math.random()*characters.length)].id;let secretB=characters[Math.floor(Math.random()*characters.length)].id;while(secretB===secretA)secretB=characters[Math.floor(Math.random()*characters.length)].id;
  const pa=sockets.get(a),pb=sockets.get(b);
  const room={id,a,b,turn:a,round:1,status:"playing",players:{[a]:{id:a,displayName:pa.displayName,secret:secretA,eliminated:[],used:new Set()},[b]:{id:b,displayName:pb.displayName,secret:secretB,eliminated:[],used:new Set()}}};
  rooms.set(id,room);pa.roomId=id;pb.roomId=id;pa.socket.join(id);pb.socket.join(id);emitPlayers();broadcastRoom(room);
}
function startDemo(socket){
  const botId=`bot_${socket.id}`;const userId=socket.user.sub;
  const secretUser=characters[Math.floor(Math.random()*characters.length)].id;let secretBot=characters[Math.floor(Math.random()*characters.length)].id;while(secretBot===secretUser)secretBot=characters[Math.floor(Math.random()*characters.length)].id;
  const room={id:`demo_${socket.id}`,a:userId,b:botId,turn:userId,round:1,status:"playing",demo:true,players:{[userId]:{id:userId,displayName:socket.user.displayName,secret:secretUser,eliminated:[],used:new Set()},[botId]:{id:botId,displayName:"Demo Bot",secret:secretBot,eliminated:[],used:new Set()}}};
  rooms.set(room.id,room);socket.data.roomId=room.id;socket.join(room.id);sockets.set(userId,{...sockets.get(userId),roomId:room.id});socket.emit("match:found",stateFor(room,userId));
}
async function recordResult(winner,loser){
  const add=async(uid,field)=>{if(!uid||uid.startsWith("bot_"))return;const u=await getUser(uid);if(!u)return;if(field==="win")u.wins=(u.wins||0)+1;else u.losses=(u.losses||0)+1;u.games=(u.games||0)+1;if(dbReady)await u.save();else memoryUsers.set(uid,u)};
  await add(winner,"win");await add(loser,"loss");
}

const io=new Server(server,{cors:{origin:FRONTEND_URL,methods:["GET","POST"]}});
io.use(socketAuth);

io.on("connection",socket=>{
  const uid=socket.user.sub;
  sockets.set(uid,{socket,displayName:socket.user.displayName||socket.user.username||"Player",avatar:"",roomId:null});
  socket.data.userId=uid;emitPlayers();
  socket.on("match:random",()=>{
    if(findRoomByUser(uid)){socket.emit("error_message",{message:"You are already in a match."});return}
    const idx=queue.indexOf(uid);if(idx>=0){socket.emit("queue:status",{message:"Already searching…"});return}
    if(queue.length){const other=queue.shift();if(other!==uid&&sockets.has(other))makeRoom(other,uid);else queue.push(uid)}
    else {queue.push(uid);socket.emit("queue:status",{message:"Searching public players…"});}
  });
  socket.on("match:cancel",()=>{const i=queue.indexOf(uid);if(i>=0)queue.splice(i,1)});
  socket.on("match:demo",()=>startDemo(socket));
  socket.on("invite:send",({to})=>{const target=sockets.get(to);if(!target||target.roomId){socket.emit("error_message",{message:"Player is no longer available."});return}const id=crypto.randomUUID();invites.set(id,{id,from:uid,to});target.socket.emit("invite:received",{id,from:{id:uid,displayName:socket.user.displayName||"Player"}});});
  socket.on("invite:accept",({inviteId})=>{const inv=invites.get(inviteId);if(!inv||inv.to!==uid){socket.emit("error_message",{message:"Invite expired."});return}const from=sockets.get(inv.from),to=sockets.get(inv.to);if(!from||!to){return}invites.delete(inviteId);makeRoom(inv.from,inv.to);});
  socket.on("invite:decline",({inviteId})=>{const inv=invites.get(inviteId);if(!inv)return;invites.delete(inviteId);const s=sockets.get(inv.from);if(s)s.socket.emit("invite:declined")});
  socket.on("game:question",({category})=>{
    const room=findRoomByUser(uid);if(!room||room.status!=="playing"){socket.emit("error_message",{message:"No active match."});return}
    if(room.turn!==uid){socket.emit("error_message",{message:"Wait for your turn."});return}
    const p=room.players[uid],opp=room.players[uid===room.a?room.b:room.a];
    if(p.used.has(category)){socket.emit("error_message",{message:"That category was already used."});return}
    if(!categories.some(c=>c.id===category)){return}
    p.used.add(category);
    const truth=categoryMatch(characters.find(c=>c.id===opp.secret),category);
    const before=opp.eliminated.length;
    opp.eliminated=characters.filter(c=>c.id!==opp.secret).filter(c=>categoryMatch(c,category)!==truth).map(c=>c.id).filter(id=>!opp.eliminated.includes(id));
    // Above adds only newly inconsistent characters; already eliminated remain.
    room.turn=opp.id;room.round++;
    broadcastRoom(room);
    socket.emit("toast_question",{category,answer:truth});
  });
  socket.on("game:guess",async({characterId})=>{
    const room=findRoomByUser(uid);if(!room||room.status!=="playing")return;
    if(room.turn!==uid){socket.emit("error_message",{message:"It is not your turn."});return}
    const p=room.players[uid],opp=room.players[uid===room.a?room.b:room.a];
    if(!characters.some(c=>c.id===characterId)||p.eliminated.includes(characterId)){socket.emit("error_message",{message:"That character is unavailable."});return}
    room.status="ended";
    const win=characterId===opp.secret;const winner=win?uid:opp.id;const loser=win?opp.id:uid;
    if(!win)p.eliminated.push(characterId);
    if(win)await recordResult(winner,loser);
    const reason=win?`${characters.find(c=>c.id===characterId).name} was the secret character.`:`Wrong guess. ${characters.find(c=>c.id===characterId).name} was not the secret character.`;
    for(const id of [room.a,room.b]){const s=sockets.get(id);if(s)s.socket.emit("game:ended",{winnerId:winner,reason})}
    emitPlayers();
  });
  socket.on("game:rematch",()=>{
    const room=findRoomByUser(uid);if(!room)return;
    const other=room.a===uid?room.b:room.a;if(other.startsWith("bot_")){room.status="playing";room.turn=uid;room.round=1;for(const p of Object.values(room.players)){p.eliminated=[];p.used=new Set();p.secret=characters[Math.floor(Math.random()*characters.length)].id}while(room.players[room.a].secret===room.players[room.b].secret)room.players[room.b].secret=characters[Math.floor(Math.random()*characters.length)].id;broadcastRoom(room);return}
    rematchWait.set(uid,{other,room});if(rematchWait.has(other)){rematchWait.delete(uid);rematchWait.delete(other);makeRoom(uid,other)}
    else socket.emit("queue:status",{message:"Waiting for opponent to accept rematch…"});
  });
  socket.on("disconnect",()=>{sockets.delete(uid);const i=queue.indexOf(uid);if(i>=0)queue.splice(i,1);const room=findRoomByUser(uid);if(room&&room.status==="playing"){const other=room.a===uid?room.b:room.a;const s=sockets.get(other);if(s)s.socket.emit("game:ended",{winnerId:other,reason:"Opponent disconnected."});room.status="ended"}emitPlayers()});
});

app.get("/api/config",(req,res)=>res.json({frontendUrl:FRONTEND_URL,backendUrl:API_URL}));
app.post("/api/demo-login",(req,res)=>{const id=`demo_${crypto.randomUUID()}`;const u=memoryUser(id,{username:"demo_player",displayName:"Demo Player",demo:true});res.json({token:sign(u),user:publicUser(u,id)})});
app.get("/api/me",auth,(req,res)=>res.json({user:publicUser(req.user,req.userId)}));
app.get("/api/stats",auth,async(req,res)=>{const u=await getUser(req.userId);res.json({stats:{wins:u.wins||0,losses:u.losses||0,games:u.games||0}})});
app.get("/api/leaderboard",async(req,res)=>{
  let arr=[];
  if(dbReady){arr=await User.find({demo:false}).sort({wins:-1,games:-1}).limit(100).lean()}
  else arr=[...memoryUsers.values()].filter(u=>!u.demo).sort((a,b)=>b.wins-a.wins||b.games-a.games).slice(0,100);
  res.json({players:arr.map(u=>({displayName:u.displayName||u.username,wins:u.wins||0,losses:u.losses||0,winRate:u.games?Math.round((u.wins||0)/u.games*100):0}))});
});

app.get("/auth/discord",(req,res)=>{
  const state=jwt.sign({nonce:crypto.randomBytes(18).toString("hex")},JWT_SECRET,{expiresIn:"10m"});
  const p=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID||"",response_type:"code",redirect_uri:process.env.DISCORD_REDIRECT_URI||`${API_URL||`http://localhost:${PORT}`}/auth/discord/callback`,scope:"identify",state});
  res.redirect(`https://discord.com/oauth2/authorize?${p}`);
});
app.get("/auth/discord/callback",async(req,res)=>{
  try{
    if(!req.query.code||!req.query.state)throw Error("Missing OAuth data");
    jwt.verify(req.query.state,JWT_SECRET);
    const body=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code:req.query.code,redirect_uri:process.env.DISCORD_REDIRECT_URI});
    const tr=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    if(!tr.ok)throw Error("Discord token exchange failed");
    const td=await tr.json();
    const ur=await fetch("https://discord.com/api/users/@me",{headers:{Authorization:`Bearer ${td.access_token}`}});
    if(!ur.ok)throw Error("Discord user lookup failed");
    const profile=await ur.json();const u=await upsertDiscord(profile);const t=sign(u);
    res.redirect(`${FRONTEND_URL}/#token=${encodeURIComponent(t)}`);
  }catch(e){console.error("Discord OAuth:",e.message);res.status(400).send("Discord login failed. Check your OAuth settings and redirect URI.");}
});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error"})});
server.listen(PORT,()=>console.log(`Backend listening on ${PORT}`));