import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

dotenv.config();
const { Pool } = pg;
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false } });

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const MANAGER_EMAIL = (process.env.MANAGER_EMAIL || "mennaaloby@gmail.com").toLowerCase();
const MANAGER_NAME = process.env.MANAGER_NAME || "MennatAllah";
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "change-this-before-launch";

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager','client','team')),
      status TEXT NOT NULL DEFAULT 'active',
      phone TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'Concept',
      progress INTEGER NOT NULL DEFAULT 0,
      budget NUMERIC(12,2) DEFAULT 0,
      client_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_team_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      recipient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      client_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reference TEXT,
      provider_reference TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS payouts (
      id SERIAL PRIMARY KEY,
      team_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reference TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS project_milestones (
      id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'locked', due_date DATE, completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS project_documents (
      id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Deliverable', version TEXT NOT NULL DEFAULT '01',
      file_url TEXT, status TEXT NOT NULL DEFAULT 'pending', description TEXT, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      file_data BYTEA, mime_type TEXT, original_name TEXT
    );
    ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS file_data BYTEA;
    ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
    ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS original_name TEXT;
    CREATE TABLE IF NOT EXISTS document_approvals (
      id SERIAL PRIMARY KEY, document_id INTEGER REFERENCES project_documents(id) ON DELETE CASCADE,
      client_id INTEGER REFERENCES users(id) ON DELETE SET NULL, decision TEXT NOT NULL, comment TEXT,
      decided_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      client_id INTEGER REFERENCES users(id) ON DELETE SET NULL, invoice_no TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, due_date DATE, status TEXT NOT NULL DEFAULT 'unpaid',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  const existing = await pool.query("SELECT id FROM users WHERE lower(email)=lower($1)", [MANAGER_EMAIL]);
  const hash = await bcrypt.hash(MANAGER_PASSWORD, 12);
  if (existing.rowCount === 0) {
    await pool.query("INSERT INTO users(name,email,password_hash,role,status) VALUES($1,$2,$3,'manager','active')",
      [MANAGER_NAME, MANAGER_EMAIL, hash]);
  } else {
    await pool.query("UPDATE users SET name=$1, role='manager', status='active' WHERE lower(email)=lower($2)",
      [MANAGER_NAME, MANAGER_EMAIL]);
  }

  const count = await pool.query("SELECT count(*)::int AS c FROM projects");
  if (count.rows[0].c === 0) {
    const clients = await pool.query("SELECT id FROM users WHERE role='client' ORDER BY id LIMIT 1");
    await pool.query(
      `INSERT INTO projects(name,type,location,status,progress,budget,client_id,image_url)
       VALUES
       ('Villa Design','Residential Villa','6 October City, Giza','In Progress',60,15000,$1,'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=80'),
       ('Office Interior Design','Interior Design','Cairo','In Review',40,9000,$1,'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1000&q=80'),
       ('Commercial Building','Architecture','New Cairo','Concept',20,45000,$1,'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1000&q=80')`,
      [clients.rows[0]?.id || null]
    );
  }
  const seedProjects = await pool.query("SELECT id FROM projects ORDER BY id LIMIT 3");
  const milestoneCount = await pool.query("SELECT count(*)::int AS c FROM project_milestones");
  if (milestoneCount.rows[0].c === 0) {
    const titles = ['Consultation','Concept Design','Preliminary Design','3D Visualization','Working Drawings','Final Delivery'];
    for (const pid of seedProjects.rows) {
      for (let i=0;i<titles.length;i++) await pool.query(
        `INSERT INTO project_milestones(project_id,title,sort_order,status) VALUES($1,$2,$3,$4)`,
        [pid.id,titles[i],i,i===0?'completed':i===1?'in_progress':'locked']
      );
    }
  }
  const docCount = await pool.query("SELECT count(*)::int AS c FROM project_documents");
  if (docCount.rows[0].c === 0 && seedProjects.rows[0]) {
    const pid=seedProjects.rows[0].id;
    await pool.query(`INSERT INTO project_documents(project_id,name,category,version,status,description) VALUES
      ($1,'Ground Floor Plan.pdf','Drawings','03','pending','Latest ground-floor drawing for client review.'),
      ($1,'Exterior 3D Render.jpg','3D / Renders','02','approved','Exterior visualization — approved revision.'),
      ($1,'Material Schedule.pdf','Documents','01','pending','Material and finish schedule for coordination.')`,[pid]);
  }
}

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req,res,next) {
  try {
    const token = req.cookies.arkieco_session;
    if (!token) return res.status(401).json({error:"Authentication required"});
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({error:"Invalid or expired session"}); }
}
function managerOnly(req,res,next){ if(req.user?.role!=="manager") return res.status(403).json({error:"Manager access required"}); next(); }

app.get("/api/health", (_,res)=>res.json({ok:true}));

app.post("/api/auth/signup", async (req,res)=>{
  const {name,email,password,phone} = req.body;
  if(!name || !email || !password || password.length < 8) return res.status(400).json({error:"Name, email and an 8+ character password are required."});
  const normalized=email.trim().toLowerCase();
  if(normalized===MANAGER_EMAIL) return res.status(409).json({error:"This email is reserved for the Manager."});
  try {
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query(
      "INSERT INTO users(name,email,password_hash,role,status,phone) VALUES($1,$2,$3,'client','active',$4) RETURNING id,name,email,role,status",
      [name.trim(),normalized,hash,phone||null]
    );
    const token=sign(r.rows[0]);
    res.cookie("arkieco_session",token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*3600*1000});
    res.json({user:r.rows[0]});
  } catch(e){ if(e.code==="23505") return res.status(409).json({error:"Email already registered."}); res.status(500).json({error:"Could not create account."}); }
});

app.post("/api/auth/login", async (req,res)=>{
  const {email,password}=req.body;
  const r=await pool.query("SELECT * FROM users WHERE lower(email)=lower($1)",[email||""]);
  if(!r.rowCount || !(await bcrypt.compare(password||"",r.rows[0].password_hash))) return res.status(401).json({error:"Incorrect email or password."});
  const u=r.rows[0];
  if(u.status!=="active") return res.status(403).json({error:"This account is awaiting Manager approval."});
  const safe={id:u.id,name:u.name,email:u.email,role:u.role,status:u.status};
  res.cookie("arkieco_session",sign(safe),{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*3600*1000});
  res.json({user:safe});
});

app.post("/api/auth/logout",(req,res)=>{res.clearCookie("arkieco_session");res.json({ok:true})});
app.get("/api/auth/me",auth,async(req,res)=>{
  const r=await pool.query("SELECT id,name,email,role,status,phone FROM users WHERE id=$1",[req.user.id]);
  res.json({user:r.rows[0]});
});

app.get("/api/projects",auth,async(req,res)=>{
  const q = req.user.role==="manager"
    ? "SELECT p.*,u.name client_name,t.name team_name FROM projects p LEFT JOIN users u ON u.id=p.client_id LEFT JOIN users t ON t.id=p.assigned_team_id ORDER BY p.updated_at DESC"
    : "SELECT p.*,u.name client_name,t.name team_name FROM projects p LEFT JOIN users u ON u.id=p.client_id LEFT JOIN users t ON t.id=p.assigned_team_id WHERE p.client_id=$1 OR p.assigned_team_id=$1 ORDER BY p.updated_at DESC";
  const r=await pool.query(q,req.user.role==="manager"?[]:[req.user.id]); res.json({projects:r.rows});
});

app.post("/api/projects",auth,managerOnly,async(req,res)=>{
  const {name,type,location,budget,client_id,assigned_team_id,image_url}=req.body;
  const r=await pool.query(
    `INSERT INTO projects(name,type,location,budget,client_id,assigned_team_id,image_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name,type,location,Number(budget||0),client_id||null,assigned_team_id||null,image_url||null]
  );
  res.json({project:r.rows[0]});
});
app.delete("/api/projects/:id",auth,managerOnly,async(req,res)=>{
  await pool.query("DELETE FROM projects WHERE id=$1",[req.params.id]); res.json({ok:true});
});

app.get("/api/team",auth,managerOnly,async(req,res)=>{
  const r=await pool.query("SELECT id,name,email,role,status,phone,created_at FROM users WHERE role='team' ORDER BY created_at DESC"); res.json({team:r.rows});
});
app.post("/api/team",auth,managerOnly,async(req,res)=>{
  const {name,email,password,phone}=req.body;
  if(!name||!email||!password||password.length<8) return res.status(400).json({error:"Name, email and 8+ character password are required."});
  try {
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query("INSERT INTO users(name,email,password_hash,role,status,phone) VALUES($1,$2,$3,'team','active',$4) RETURNING id,name,email,role,status,phone",
      [name,email.toLowerCase(),hash,phone||null]);
    res.json({member:r.rows[0]});
  } catch(e){ if(e.code==="23505") return res.status(409).json({error:"Email already registered."}); res.status(500).json({error:"Could not add team member."}); }
});
app.delete("/api/team/:id",auth,managerOnly,async(req,res)=>{ await pool.query("DELETE FROM users WHERE id=$1 AND role='team'",[req.params.id]); res.json({ok:true}); });

app.get("/api/clients",auth,managerOnly,async(req,res)=>{
  const r=await pool.query("SELECT id,name,email,phone,created_at FROM users WHERE role='client' ORDER BY created_at DESC"); res.json({clients:r.rows});
});

async function projectForUser(projectId,user){
  const r=await pool.query("SELECT * FROM projects WHERE id=$1",[projectId]);
  if(!r.rowCount) return null;
  const p=r.rows[0];
  if(user.role==='manager' || p.client_id===user.id || p.assigned_team_id===user.id) return p;
  return false;
}
function projectGuard(req,res,next){ projectForUser(req.params.projectId,req.user).then(p=>{ if(!p) return res.status(p===null?404:403).json({error:p===null?'Project not found':'Project access denied'}); req.project=p; next(); }).catch(()=>res.status(500).json({error:'Project access check failed'})); }

app.get('/api/projects/:projectId/workspace',auth,projectGuard,async(req,res)=>{
  const pid=req.params.projectId;
  const [m,d,a,i]=await Promise.all([
    pool.query('SELECT * FROM project_milestones WHERE project_id=$1 ORDER BY sort_order,id',[pid]),
    pool.query(`SELECT d.*,u.name uploaded_by_name,(SELECT json_agg(a ORDER BY a.decided_at DESC) FROM document_approvals a WHERE a.document_id=d.id) approvals FROM project_documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.project_id=$1 ORDER BY d.created_at DESC`,[pid]),
    pool.query(`SELECT a.*,d.name document_name,u.name client_name FROM document_approvals a LEFT JOIN project_documents d ON d.id=a.document_id LEFT JOIN users u ON u.id=a.client_id WHERE d.project_id=$1 ORDER BY a.decided_at DESC`,[pid]),
    pool.query('SELECT * FROM invoices WHERE project_id=$1 ORDER BY created_at DESC',[pid])
  ]);
  res.json({project:req.project,milestones:m.rows,documents:d.rows,approvals:a.rows,invoices:i.rows});
});
app.post('/api/projects/:projectId/milestones',auth,managerOnly,async(req,res)=>{
  const {title,description,due_date,sort_order,status}=req.body;
  if(!title) return res.status(400).json({error:'Milestone title is required.'});
  const r=await pool.query(`INSERT INTO project_milestones(project_id,title,description,due_date,sort_order,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.params.projectId,title,description||null,due_date||null,Number(sort_order||0),status||'locked']);
  res.json({milestone:r.rows[0]});
});
app.patch('/api/milestones/:id',auth,managerOnly,async(req,res)=>{
  const {status,due_date,title,description}=req.body;
  const r=await pool.query(`UPDATE project_milestones SET status=COALESCE($1,status),due_date=COALESCE($2,due_date),title=COALESCE($3,title),description=COALESCE($4,description),completed_at=CASE WHEN $1='completed' THEN now() ELSE completed_at END WHERE id=$5 RETURNING *`,[status||null,due_date||null,title||null,description||null,req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:'Milestone not found'}); res.json({milestone:r.rows[0]});
});
app.post('/api/projects/:projectId/documents/upload',auth,managerOnly,express.raw({type:'application/octet-stream',limit:'20mb'}),async(req,res)=>{
  const p=await projectForUser(req.params.projectId,req.user); if(!p) return res.status(p===null?404:403).json({error:p===null?'Project not found':'Project access denied'});
  if(!req.body?.length) return res.status(400).json({error:'File is empty.'});
  const name=decodeURIComponent(req.headers['x-file-name']||'deliverable');
  const category=req.headers['x-category']||'Deliverable';
  const version=req.headers['x-version']||'01';
  const mime=req.headers['x-file-type']||'application/octet-stream';
  const r=await pool.query(`INSERT INTO project_documents(project_id,name,category,version,status,uploaded_by,file_data,mime_type,original_name) VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8) RETURNING id,name,category,version,status`,[req.params.projectId,name,category,version,req.user.id,req.body,mime,name]);
  res.json({document:r.rows[0]});
});
app.get('/api/documents/:id/file',auth,async(req,res)=>{
  const r=await pool.query(`SELECT d.file_data,d.mime_type,d.original_name,p.client_id,p.assigned_team_id FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE d.id=$1`,[req.params.id]);
  if(!r.rowCount) return res.status(404).send('File not found'); const d=r.rows[0];
  if(req.user.role!=='manager' && ![d.client_id,d.assigned_team_id].includes(req.user.id)) return res.status(403).send('Access denied');
  if(!d.file_data) return res.status(404).send('No uploaded file is attached to this deliverable.');
  res.setHeader('Content-Type',d.mime_type||'application/octet-stream'); res.setHeader('Content-Disposition',`inline; filename="${String(d.original_name||'deliverable').replace(/"/g,'') }"`); res.send(d.file_data);
});

app.post('/api/projects/:projectId/documents',auth,managerOnly,async(req,res)=>{
  const {name,category,version,file_url,status,description}=req.body;
  if(!name) return res.status(400).json({error:'Document name is required.'});
  const r=await pool.query(`INSERT INTO project_documents(project_id,name,category,version,file_url,status,description,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[req.params.projectId,name,category||'Deliverable',version||'01',file_url||null,status||'pending',description||null,req.user.id]);
  res.json({document:r.rows[0]});
});
app.patch('/api/documents/:id',auth,managerOnly,async(req,res)=>{
  const {status,version,file_url,description}=req.body;
  const r=await pool.query(`UPDATE project_documents SET status=COALESCE($1,status),version=COALESCE($2,version),file_url=COALESCE($3,file_url),description=COALESCE($4,description) WHERE id=$5 RETURNING *`,[status||null,version||null,file_url||null,description||null,req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:'Document not found'}); res.json({document:r.rows[0]});
});
app.post('/api/documents/:id/approval',auth,async(req,res)=>{
  const {decision,comment}=req.body;
  if(!['approved','changes_requested'].includes(decision)) return res.status(400).json({error:'Invalid approval decision.'});
  const d=await pool.query('SELECT d.*,p.client_id FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE d.id=$1',[req.params.id]);
  if(!d.rowCount) return res.status(404).json({error:'Document not found'});
  if(req.user.role!=='manager' && d.rows[0].client_id!==req.user.id) return res.status(403).json({error:'Only the assigned client or Manager can review this document.'});
  const r=await pool.query('INSERT INTO document_approvals(document_id,client_id,decision,comment) VALUES($1,$2,$3,$4) RETURNING *',[req.params.id,req.user.id,decision,comment||null]);
  await pool.query('UPDATE project_documents SET status=$1 WHERE id=$2',[decision==='approved'?'approved':'changes_requested',req.params.id]);
  res.json({approval:r.rows[0]});
});
app.post('/api/projects/:projectId/invoices',auth,managerOnly,async(req,res)=>{
  const {title,amount,due_date}=req.body;
  const p=await projectForUser(req.params.projectId,req.user); if(!p) return res.status(404).json({error:'Project not found'});
  if(!p.client_id) return res.status(400).json({error:'Assign a client before creating an invoice.'});
  const invoiceNo=`ARK-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const r=await pool.query(`INSERT INTO invoices(project_id,client_id,invoice_no,title,amount,due_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.params.projectId,p.client_id,invoiceNo,title||'Architectural services',Number(amount||0),due_date||null]);
  res.json({invoice:r.rows[0]});
});
app.patch('/api/projects/:id',auth,managerOnly,async(req,res)=>{
  const {status,progress,client_id,assigned_team_id,budget}=req.body;
  const r=await pool.query(`UPDATE projects SET status=COALESCE($1,status),progress=COALESCE($2,progress),client_id=COALESCE($3,client_id),assigned_team_id=COALESCE($4,assigned_team_id),budget=COALESCE($5,budget),updated_at=now() WHERE id=$6 RETURNING *`,[status??null,progress===''?null:Number(progress),client_id===''?null:client_id,assigned_team_id===''?null:assigned_team_id,budget===''?null:Number(budget),req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:'Project not found'}); res.json({project:r.rows[0]});
});

app.get("/api/messages/:projectId",auth,async(req,res)=>{
  const p=await projectForUser(req.params.projectId,req.user);
  if(!p) return res.status(p===null?404:403).json({error:p===null?"Project not found":"You do not have access to this project chat."});
  const r=await pool.query(`
    SELECT m.*,s.name sender_name,s.role sender_role
    FROM messages m LEFT JOIN users s ON s.id=m.sender_id
    WHERE m.project_id=$1
    ORDER BY m.created_at ASC`,[req.params.projectId]);
  res.json({messages:r.rows});
});
app.post("/api/messages",auth,async(req,res)=>{
  const {project_id,body}=req.body;
  if(!body?.trim()) return res.status(400).json({error:"Message cannot be empty."});
  const p=await pool.query("SELECT client_id,assigned_team_id FROM projects WHERE id=$1",[project_id]);
  if(!p.rowCount) return res.status(404).json({error:"Project not found"});
  const allowed=req.user.role==="manager" || [p.rows[0].client_id,p.rows[0].assigned_team_id].includes(req.user.id);
  if(!allowed) return res.status(403).json({error:"You do not have access to this project chat."});
  const r=await pool.query("INSERT INTO messages(project_id,sender_id,body) VALUES($1,$2,$3) RETURNING *",[project_id,req.user.id,body.trim()]);
  res.json({message:r.rows[0]});
});

app.get("/api/payments",auth,async(req,res)=>{
  const q=req.user.role==="manager"
    ?"SELECT p.*,pr.name project_name,u.name client_name FROM payments p LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN users u ON u.id=p.client_id ORDER BY p.created_at DESC"
    :"SELECT p.*,pr.name project_name,u.name client_name FROM payments p LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN users u ON u.id=p.client_id WHERE p.client_id=$1 ORDER BY p.created_at DESC";
  const r=await pool.query(q,req.user.role==="manager"?[]:[req.user.id]); res.json({payments:r.rows});
});
app.post("/api/payments/record",auth,async(req,res)=>{
  const {project_id,amount,method,reference}=req.body;
  const p=await projectForUser(project_id,req.user);
  if(!p) return res.status(p===null?404:403).json({error:p===null?"Project not found":"You can only submit payment for your own project."});
  if(req.user.role!=="manager" && p.client_id!==req.user.id) return res.status(403).json({error:"Only the assigned client can submit this payment."});
  const value=Number(amount); if(!value || value<=0) return res.status(400).json({error:"Invalid payment amount."});
  const r=await pool.query("INSERT INTO payments(project_id,client_id,amount,method,reference) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [project_id,p.client_id||req.user.id,value,method||"manual",reference||null]);
  res.json({payment:r.rows[0]});
});
app.post("/api/payments/:id/approve",auth,managerOnly,async(req,res)=>{
  const r=await pool.query("UPDATE payments SET status='paid' WHERE id=$1 RETURNING *",[req.params.id]);
  res.json({payment:r.rows[0]});
});

app.get("/api/payouts",auth,managerOnly,async(req,res)=>{
  const r=await pool.query("SELECT p.*,u.name team_name,u.email FROM payouts p LEFT JOIN users u ON u.id=p.team_id ORDER BY p.created_at DESC"); res.json({payouts:r.rows});
});
app.post("/api/payouts",auth,managerOnly,async(req,res)=>{
  const {team_id,amount,method,reference}=req.body;
  const r=await pool.query("INSERT INTO payouts(team_id,amount,method,reference) VALUES($1,$2,$3,$4) RETURNING *",[team_id,Number(amount),method,reference||null]);
  res.json({payout:r.rows[0]});
});

/*
  Optional Paymob intention endpoint.
  Add verified live credentials before enabling it.
  The secret key never reaches the browser.
*/
app.post("/api/payments/paymob-intention",auth,async(req,res)=>{
  const {project_id,amount,phone}=req.body;
  if(!process.env.PAYMOB_SECRET_KEY || !process.env.PAYMOB_PAYMENT_INTEGRATION_ID)
    return res.status(503).json({error:"Paymob live credentials are not configured yet."});
  const cents=Math.round(Number(amount)*100);
  if(!cents || cents<100) return res.status(400).json({error:"Invalid amount."});
  const u=(await pool.query("SELECT name,email FROM users WHERE id=$1",[req.user.id])).rows[0];
  const [first_name,...rest]=u.name.split(" ");
  const last_name=rest.join(" ")||"Client";
  const body={
    amount:cents,currency:"EGP",
    payment_methods:[Number(process.env.PAYMOB_PAYMENT_INTEGRATION_ID)],
    items:[{name:"ÀRKIECO architectural service",amount:cents,description:`Project ${project_id}`,quantity:1}],
    billing_data:{apartment:"NA",floor:"NA",first_name,last_name,street:"NA",building:"NA",phone_number:phone||"NA",city:"Cairo",country:"EG",state:"Cairo",email:u.email},
    special_reference:`ARK-${project_id}-${crypto.randomUUID()}`,
    expiration:3600,
    redirection_url:`${process.env.APP_URL||"http://localhost:3000"}/?payment=complete`
  };
  const r=await fetch(`${process.env.PAYMOB_BASE_URL||"https://accept.paymob.com"}/v1/intention/`,{
    method:"POST",headers:{"Authorization":`Token ${process.env.PAYMOB_SECRET_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  const data=await r.json();
  if(!r.ok) return res.status(502).json({error:"Paymob rejected the payment intention.",details:data});
  res.json({client_secret:data.client_secret,intention_id:data.id,public_key:process.env.PAYMOB_PUBLIC_KEY});
});

initDb().then(()=>{
  app.listen(PORT,()=>console.log(`ÀRKIECO running on http://localhost:${PORT}`));
}).catch(err=>{console.error(err);process.exit(1)});
