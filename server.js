require("dotenv").config();

const { timingSafeEqual } = require("crypto");
const express = require("express");
const fs = require("fs/promises");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const databaseName = process.env.DB_NAME || "fagym";
const adminUser = process.env.ADMIN_USER || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const localMembersPath = path.join(__dirname, ".data", "members.json");
const validPlans = new Set(["monthly", "quarterly", "half-yearly", "yearly"]);
const photoPattern = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error("DB_NAME may contain only letters, numbers, and underscores.");
}
if (isProduction && (!adminUser || !adminPassword)) {
    throw new Error("ADMIN_USER and ADMIN_PASSWORD must be configured in production.");
}

const mysqlOptions = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    ...(process.env.DB_SSL === "true"
        ? { ssl: { ca: process.env.DB_SSL_CA || undefined, rejectUnauthorized: true } }
        : {}),
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true
};
let pool;
let databaseReady = false;
let databaseUnavailable = false;
let localWriteQueue = Promise.resolve();

const ensureDatabaseReady = async () => {
    if (!pool) {
        throw new Error("MySQL connection pool is not initialized.");
    }
    await pool.query("SELECT 1");
    if (databaseReady) {
        return;
    }
    await pool.query(
        `CREATE TABLE IF NOT EXISTS members (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            full_name VARCHAR(160) NOT NULL,
            phone VARCHAR(40) NOT NULL,
            email VARCHAR(254) NOT NULL,
            plan VARCHAR(32) NOT NULL,
            start_date DATE NOT NULL,
            goal TEXT NOT NULL,
            contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
            photo MEDIUMTEXT NULL,
            submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_members_name (full_name),
            INDEX idx_members_email (email),
            INDEX idx_members_phone (phone)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    databaseReady = true;
};

const readLocalMembers = async () => {
    try {
        const contents = await fs.readFile(localMembersPath, "utf8");
        const members = JSON.parse(contents);
        if (!Array.isArray(members)) {
            throw new Error("The local member data file must contain a JSON array.");
        }
        return members;
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
};

const updateLocalMembers = (update) => {
    const save = async () => {
        const members = await readLocalMembers();
        const result = update(members);
        if (result === null) {
            return null;
        }
        await fs.mkdir(path.dirname(localMembersPath), { recursive: true });
        const temporaryPath = localMembersPath + ".tmp";
        await fs.writeFile(temporaryPath, JSON.stringify(members, null, 2), "utf8");
        await fs.rename(temporaryPath, localMembersPath);
        return result;
    };
    const write = localWriteQueue.then(save, save);
    localWriteQueue = write.then(() => undefined, () => undefined);
    return write;
};

const canUseDatabase = async () => {
    try {
        await ensureDatabaseReady();
        if (databaseUnavailable) {
            console.log("MySQL connection restored.");
        }
        databaseUnavailable = false;
        return true;
    } catch (error) {
        if (!databaseUnavailable) {
            console.error(
                isProduction
                    ? "MySQL is unavailable; hosted member operations cannot continue."
                    : "MySQL is unavailable; member data will use the local file store.",
                error.message
            );
        }
        databaseUnavailable = true;
        return false;
    }
};

const requireAdmin = (request, response, next) => {
    if (!isProduction) {
        next();
        return;
    }

    const [scheme, encodedCredentials] = (request.headers.authorization || "").split(" ");
    if (scheme !== "Basic" || !encodedCredentials) {
        response.set("WWW-Authenticate", 'Basic realm="FA.GYM Member Store", charset="UTF-8"');
        response.status(401).send("Admin sign-in required.");
        return;
    }

    const credentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    if (separator < 0) {
        response.set("WWW-Authenticate", 'Basic realm="FA.GYM Member Store", charset="UTF-8"');
        response.status(401).send("Admin sign-in required.");
        return;
    }

    const suppliedUser = Buffer.from(credentials.slice(0, separator), "utf8");
    const expectedUser = Buffer.from(adminUser, "utf8");
    const suppliedPassword = Buffer.from(credentials.slice(separator + 1), "utf8");
    const expectedPassword = Buffer.from(adminPassword, "utf8");
    const userMatches = suppliedUser.length === expectedUser.length &&
        timingSafeEqual(suppliedUser, expectedUser);
    const passwordMatches = suppliedPassword.length === expectedPassword.length &&
        timingSafeEqual(suppliedPassword, expectedPassword);

    if (!userMatches || !passwordMatches) {
        response.set("WWW-Authenticate", 'Basic realm="FA.GYM Member Store", charset="UTF-8"');
        response.status(401).send("Admin sign-in required.");
        return;
    }

    response.set("Cache-Control", "no-store");
    next();
};

app.use(express.json({ limit: "8mb" }));
app.use("/.data", (request, response) => response.sendStatus(404));
app.get("/healthz", async (request, response) => {
    if (await canUseDatabase()) {
        response.status(200).send("ok");
        return;
    }
    response.status(503).send("Database unavailable");
});
app.get("/member-store.html", requireAdmin);
app.use(express.static(__dirname));

const validateMember = (member) => {
    if (!member || typeof member !== "object" || Array.isArray(member)) {
        return "Member details are required.";
    }
    if (typeof member.fullName !== "string" || !member.fullName.trim() || member.fullName.length > 160) {
        return "Enter a name of 1 to 160 characters.";
    }
    if (typeof member.phone !== "string" || !member.phone.trim() || member.phone.length > 40) {
        return "Enter a phone number of 1 to 40 characters.";
    }
    if (typeof member.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email) || member.email.length > 254) {
        return "Enter a valid email address.";
    }
    if (!validPlans.has(member.plan)) {
        return "Choose a valid membership plan.";
    }
    if (typeof member.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(member.startDate) ||
        Number.isNaN(Date.parse(member.startDate))) {
        return "Choose a valid membership start date.";
    }
    if (typeof member.goal !== "string" || member.goal.length > 10000) {
        return "Fitness goal must be 10,000 characters or less.";
    }
    if (member.photo && (typeof member.photo !== "string" ||
        member.photo.length > 6 * 1024 * 1024 || !photoPattern.test(member.photo))) {
        return "Choose a supported member photo smaller than 6 MB.";
    }
    return "";
};

const toMember = (row) => ({
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    plan: row.plan,
    startDate: row.start_date,
    goal: row.goal,
    contactConsent: Boolean(row.contact_consent),
    photo: row.photo || "",
    submittedAt: String(row.submitted_at).replace(" ", "T")
});

const memberColumns = "id, full_name, phone, email, plan, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, goal, contact_consent, photo, submitted_at";

app.get("/api/members", requireAdmin, async (request, response, next) => {
    try {
        if (!(await canUseDatabase())) {
            if (isProduction) {
                response.status(503).json({ error: "The member database is unavailable. No data was saved." });
                return;
            }
            response.set("X-Storage-Mode", "local");
            const members = await readLocalMembers();
            members.sort((first, second) => second.submittedAt.localeCompare(first.submittedAt));
            response.json(members);
            return;
        }

        const [rows] = await pool.execute(
            `SELECT ${memberColumns} FROM members ORDER BY submitted_at DESC, id DESC`
        );
        const localMembers = isProduction ? [] : await readLocalMembers();
        response.set("X-Storage-Mode", localMembers.length ? "mixed" : "mysql");
        response.json([...rows.map(toMember), ...localMembers]
            .sort((first, second) => second.submittedAt.localeCompare(first.submittedAt)));
    } catch (error) {
        next(error);
    }
});

app.post("/api/members", async (request, response, next) => {
    const validationError = validateMember(request.body);
    if (validationError) {
        response.status(400).json({ error: validationError });
        return;
    }

    try {
        const member = request.body;
        if (!(await canUseDatabase())) {
            if (isProduction) {
                response.status(503).json({ error: "The member database is unavailable. No data was saved." });
                return;
            }
            const localMember = await updateLocalMembers((members) => {
                const nextId = members.reduce((lowest, savedMember) => Math.min(lowest, savedMember.id), 0) - 1;
                if (!Number.isSafeInteger(nextId)) {
                    throw new Error("The local member store has reached its ID limit.");
                }
                const savedMember = {
                    id: nextId,
                    fullName: member.fullName.trim(),
                    phone: member.phone.trim(),
                    email: member.email.trim(),
                    plan: member.plan,
                    startDate: member.startDate,
                    goal: member.goal,
                    contactConsent: Boolean(member.contactConsent),
                    photo: member.photo || "",
                    submittedAt: new Date().toISOString()
                };
                members.push(savedMember);
                return savedMember;
            });
            response.set("X-Storage-Mode", "local");
            response.status(201).json(localMember);
            return;
        }

        const [result] = await pool.execute(
            `INSERT INTO members
                (full_name, phone, email, plan, start_date, goal, contact_consent, photo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                member.fullName.trim(),
                member.phone.trim(),
                member.email.trim(),
                member.plan,
                member.startDate,
                member.goal,
                Boolean(member.contactConsent),
                member.photo || null
            ]
        );
        const [rows] = await pool.execute(
            `SELECT ${memberColumns} FROM members WHERE id = ?`,
            [result.insertId]
        );
        response.set("X-Storage-Mode", "mysql");
        response.status(201).json(toMember(rows[0]));
    } catch (error) {
        next(error);
    }
});

app.put("/api/members/:id", requireAdmin, async (request, response, next) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id === 0) {
        response.status(400).json({ error: "Invalid member ID." });
        return;
    }
    const validationError = validateMember(request.body);
    if (validationError) {
        response.status(400).json({ error: validationError });
        return;
    }

    try {
        const member = request.body;
        if (id < 0) {
            if (isProduction) {
                response.status(404).json({ error: "This locally saved member has not been migrated to the hosted database." });
                return;
            }
            const updatedMember = await updateLocalMembers((members) => {
                const index = members.findIndex((savedMember) => savedMember.id === id);
                if (index === -1) {
                    return null;
                }
                const savedMember = {
                    ...members[index],
                    fullName: member.fullName.trim(),
                    phone: member.phone.trim(),
                    email: member.email.trim(),
                    plan: member.plan,
                    startDate: member.startDate,
                    goal: member.goal,
                    contactConsent: Boolean(member.contactConsent),
                    photo: member.photo || ""
                };
                members[index] = savedMember;
                return savedMember;
            });
            if (!updatedMember) {
                response.status(404).json({ error: "Member not found." });
                return;
            }
            response.set("X-Storage-Mode", "local");
            response.json(updatedMember);
            return;
        }

        if (!(await canUseDatabase())) {
            response.status(503).json({
                error: "This member is in MySQL, which is currently unavailable. Restore the MySQL connection and try again."
            });
            return;
        }

        const [result] = await pool.execute(
            `UPDATE members
             SET full_name = ?, phone = ?, email = ?, plan = ?, start_date = ?,
                 goal = ?, contact_consent = ?, photo = ?
             WHERE id = ?`,
            [
                member.fullName.trim(),
                member.phone.trim(),
                member.email.trim(),
                member.plan,
                member.startDate,
                member.goal,
                Boolean(member.contactConsent),
                member.photo || null,
                id
            ]
        );
        if (!result.affectedRows) {
            response.status(404).json({ error: "Member not found." });
            return;
        }
        const [rows] = await pool.execute(
            `SELECT ${memberColumns} FROM members WHERE id = ?`,
            [id]
        );
        response.set("X-Storage-Mode", "mysql");
        response.json(toMember(rows[0]));
    } catch (error) {
        next(error);
    }
});

app.use("/api", (error, request, response, next) => {
    if (error.type === "entity.too.large") {
        response.status(413).json({ error: "Request is too large. Resize the member photo and try again." });
        return;
    }
    console.error("Membership API error:", error);
    response.status(503).json({
        error: "Member data could not be saved. Check MySQL access or write permissions for the local data folder."
    });
});

const start = async () => {
    pool = mysql.createPool({ ...mysqlOptions, database: databaseName });
    if (await canUseDatabase()) {
        console.log("MySQL connected and the member table is ready.");
    }
    app.listen(port, host, () => {
        console.log(`FA.GYM is ready at http://${host}:${port}`);
    });
};

start().catch(async (error) => {
    console.error("Could not start FA.GYM.", error.message);
    if (pool) {
        await pool.end();
    }
    process.exitCode = 1;
});
