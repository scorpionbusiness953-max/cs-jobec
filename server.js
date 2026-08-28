import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import multer from 'multer';
import cron from 'node-cron';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import path from 'path';

dotenv.config();

// Sécurité globale pour empêcher tout crash imprévu du serveur Node.js
process.on('uncaughtException', (err) => {
    console.error('Erreur non attrapée (évite le crash) :', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejet de promesse non géré :', reason);
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- ROUTE RACINE (ACCUEIL) ---
app.get('/', (req, res) => {
  res.send('Bienvenue sur l’application officielle du CS Jobec ! 🎓');
});

// --- FONCTION D’ENVOI WHATSAPP (API Meta) ---
async function sendWhatsAppNotification(to, messageText) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log('WhatsApp ignoré : Identifiants manquants.');
    return { success: false, error: 'Identifiants WhatsApp manquants' };
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: messageText }
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('WhatsApp envoyé avec succès :', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Erreur WhatsApp :', error.response ? error.response.data : error.message);
    return { success: false, error: error.response ? error.response.data : error.message };
  }
}

// Configuration de Multer : 
// 1. Pour le personnel (stockage en mémoire pour insertion en base de données)
const uploadMemory = multer({ storage: multer.memoryStorage() });

// 2. Pour la bibliothèque (stockage disque avec conservation de l'extension d'origine .pdf)
const storageDisk = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadDisk = multer({ storage: storageDisk });

// Connexion à la base de données Neon (avec options de robustesse et SSL strict)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

pool.on('error', (err, client) => {
    console.error('Erreur inattendue sur un client PostgreSQL inactif', err);
});

pool.connect()
  .then(() => console.log('Connecté à la base de données Neon avec succès !'))
  .catch(err => console.error('Erreur de connexion à la base de données', err));

// --- TÂCHE PLANIFIÉE : VÉRIFICATION DES ANNIVERSAIRES (Tous les jours à 08h00) ---
cron.schedule('0 8 * * *', async () => {
  console.log("Vérification quotidienne des anniversaires du personnel...");
  try {
    const result = await pool.query('SELECT nom, prenom, date_naissance, fonction FROM personnels WHERE date_naissance IS NOT NULL');
    const today = new Date();
    
    for (const emp of result.rows) {
      const birthDate = new Date(emp.date_naissance);
      const thisYearBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
      const oneMonthBefore = new Date(thisYearBirthday);
      oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);

      const isToday = today.getDate() === thisYearBirthday.getDate() && today.getMonth() === thisYearBirthday.getMonth();
      const isOneMonthBefore = today.getDate() === oneMonthBefore.getDate() && today.getMonth() === oneMonthBefore.getMonth();

      let message = "";

      if (isOneMonthBefore) {
        message = `🔔 Rappel RH :\nDans 1 mois (${thisYearBirthday.toLocaleDateString('fr-FR')}), ${emp.prenom} ${emp.nom} (${emp.fonction}) fêtera son anniversaire !`;
      } else if (isToday) {
        message = `🎉 Joyeux anniversaire !\nC'est aujourd'hui ! Joyeux anniversaire à ${emp.prenom} ${emp.nom} (${emp.fonction}) du CS Jobec ! 🎂`;
      }

      if (message && process.env.ADMIN_WHATSAPP) {
        await sendWhatsAppNotification(process.env.ADMIN_WHATSAPP, message);
        console.log(`Notification WhatsApp envoyée pour l'anniversaire de ${emp.prenom} ${emp.nom}`);
      }
    }
  } catch (err) {
    console.error("Erreur lors de la vérification des anniversaires :", err);
  }
});

// --- ROUTES API ---

app.get('/api/test-whatsapp', async (req, res) => {
  const adminPhone = process.env.ADMIN_WHATSAPP;
  if (!adminPhone) {
    return res.status(400).json({ success: false, error: "ADMIN_WHATSAPP non défini dans le fichier .env" });
  }
  const testMessage = "🎂 Alerte Test : Le système de notification d'anniversaire Espace RH fonctionne parfaitement sur WhatsApp !";
  const result = await sendWhatsAppNotification(adminPhone, testMessage);
  res.json(result);
});

app.get('/api/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTE FINANCES : TOTAUX (Toutes les dépenses/sorties valides confondues) ---
app.get('/api/finances/totaux', async (req, res) => {
    try {
        // 1. Récupérer les totaux des recettes (élèves)
        const queryEntrees = `
            SELECT 
                SUM(frais_inscription) AS total_inscription, 
                SUM(montant_t1) AS total_t1, 
                SUM(montant_t2) AS total_t2, 
                SUM(montant_t3) AS total_t3 
            FROM paiements;
        `;
        const resEntrees = await pool.query(queryEntrees);

        // 2. Récupérer le total global de TOUTES les sorties valides (Salaires + Dépenses + Transports, etc.)
        const querySorties = `
            SELECT SUM(montant) AS total_depenses 
            FROM transactions_sorties 
            WHERE statut = 'VALIDE';
        `;
        const resSorties = await pool.query(querySorties);

        const dataEntrees = resEntrees.rows[0] || {};
        const dataSorties = resSorties.rows[0] || {};

        res.json({ 
            success: true, 
            data: {
                total_inscription: parseFloat(dataEntrees.total_inscription || 0),
                total_t1: parseFloat(dataEntrees.total_t1 || 0),
                total_t2: parseFloat(dataEntrees.total_t2 || 0),
                total_t3: parseFloat(dataEntrees.total_t3 || 0),
                total_depenses: parseFloat(dataSorties.total_depenses || 0)
            }
        });
    } catch (err) {
        console.error("Erreur lors de la récupération des totaux financiers :", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Enregistrer un nouveau paiement / dépense
app.post('/api/transactions', async (req, res) => {
    try {
        const { type, destinataire, montant, description } = req.body;
        const result = await pool.query(
            `INSERT INTO transactions_sorties (type_transaction, destinataire, montant, description, statut) 
             VALUES ($1, $2, $3, $4, 'VALIDE') RETURNING *`,
            [type, destinataire, montant, description]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Modifier un paiement / dépense existant
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { type, destinataire, montant, description } = req.body;
        const result = await pool.query(
            `UPDATE transactions_sorties 
             SET type_transaction = $1, destinataire = $2, montant = $3, description = $4 
             WHERE id = $5 RETURNING *`,
            [type, destinataire, montant, description, id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Récupérer toutes les transactions de sortie
app.get('/api/transactions', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transactions_sorties ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/eleves', async (req, res) => {
    try {
        // Ajout de 'matricule' dans la sélection
        const result = await pool.query('SELECT id, matricule, nom, postnom, prenom, classe, cycle FROM eleves ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur lors de la récupération des élèves :", err);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Route pour "Annuler" un paiement au lieu de le supprimer
app.put('/api/transactions/annuler/:id', async (req, res) => {
    try {
        const result = await pool.query(
            "UPDATE transactions_sorties SET statut = 'ANNULE' WHERE id = $1 RETURNING *",
            [req.params.id]
        );
        res.json({ success: true, message: "Transaction annulée" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/personnels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM personnels ORDER BY nom ASC');
    const formattedRows = result.rows.map(row => ({
      ...row,
      photo: row.photo ? `data:image/jpeg;base64,${row.photo.toString('base64')}` : null,
      dossier_pdf: row.dossier_pdf ? `data:application/pdf;base64,${row.dossier_pdf.toString('base64')}` : null
    }));
    res.json(formattedRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/personnels', uploadMemory.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'dossier_pdf', maxCount: 1 }
]), async (req, res) => {
  const { 
    nom, prenom, fonction, telephone, email, adresse, date_naissance, salaire_base,
    etat_civil, nbr_enfant, titre_scolaire, option_scolaire, annee_titre_scolaire,
    titre_academique, filiere_academique, annee_titre_academique, autres_formations, cours_dispenses, autres_roles
  } = req.body;
  
  const photoBuffer = req.files && req.files['photo'] ? req.files['photo'][0].buffer : null;
  const pdfBuffer = req.files && req.files['dossier_pdf'] ? req.files['dossier_pdf'][0].buffer : null;

  try {
    const query = `
      INSERT INTO personnels (
        nom, prenom, fonction, telephone, email, adresse, date_naissance, salaire_base, 
        etat_civil, nbr_enfant, titre_scolaire, option_scolaire, annee_titre_scolaire, 
        titre_academique, filiere_academique, annee_titre_academique, autres_formations, 
        photo, dossier_pdf, cours_dispenses, autres_roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) 
      RETURNING *
    `;
    const values = [
      nom, prenom, fonction, telephone, email, adresse || null, date_naissance || null, salaire_base || null,
      etat_civil || null, nbr_enfant || 0, titre_scolaire || null, option_scolaire || null, annee_titre_scolaire || null,
      titre_academique || null, filiere_academique || null, annee_titre_academique || null, autres_formations || null,
      photoBuffer, pdfBuffer, cours_dispenses || null, autres_roles || null
    ];
    const result = await pool.query(query, values);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/personnels/:id', uploadMemory.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'dossier_pdf', maxCount: 1 }
]), async (req, res) => {
  const { id } = req.params;
  const { 
    nom, prenom, fonction, telephone, email, adresse, date_naissance, salaire_base,
    etat_civil, nbr_enfant, titre_scolaire, option_scolaire, annee_titre_scolaire,
    titre_academique, filiere_academique, annee_titre_academique, autres_formations, cours_dispenses, autres_roles 
  } = req.body;
  
  const photoBuffer = req.files && req.files['photo'] ? req.files['photo'][0].buffer : null;
  const pdfBuffer = req.files && req.files['dossier_pdf'] ? req.files['dossier_pdf'][0].buffer : null;

  try {
    let query, values;
    if (photoBuffer && pdfBuffer) {
      query = `UPDATE personnels SET nom=$1, prenom=$2, fonction=$3, telephone=$4, email=$5, adresse=$6, date_naissance=$7, salaire_base=$8, etat_civil=$9, nbr_enfant=$10, titre_scolaire=$11, option_scolaire=$12, annee_titre_scolaire=$13, titre_academique=$14, filiere_academique=$15, annee_titre_academique=$16, autres_formations=$17, photo=$18, dossier_pdf=$19, cours_dispenses=$20, autres_roles=$21 WHERE id=$22 RETURNING *`;
      values = [nom, prenom, fonction, telephone, email, adresse || null, date_naissance || null, salaire_base || null, etat_civil || null, nbr_enfant || 0, titre_scolaire || null, option_scolaire || null, annee_titre_scolaire || null, titre_academique || null, filiere_academique || null, annee_titre_academique || null, autres_formations || null, photoBuffer, pdfBuffer, cours_dispenses || null, autres_roles || null, id];
    } else if (photoBuffer) {
      query = `UPDATE personnels SET nom=$1, prenom=$2, fonction=$3, telephone=$4, email=$5, adresse=$6, date_naissance=$7, salaire_base=$8, etat_civil=$9, nbr_enfant=$10, titre_scolaire=$11, option_scolaire=$12, annee_titre_scolaire=$13, titre_academique=$14, filiere_academique=$15, annee_titre_academique=$16, autres_formations=$17, photo=$18, cours_dispenses=$19, autres_roles=$20 WHERE id=$21 RETURNING *`;
      values = [nom, prenom, fonction, telephone, email, adresse || null, date_naissance || null, salaire_base || null, etat_civil || null, nbr_enfant || 0, titre_scolaire || null, option_scolaire || null, annee_titre_scolaire || null, titre_academique || null, filiere_academique || null, annee_titre_academique || null, autres_formations || null, photoBuffer, cours_dispenses || null, autres_roles || null, id];
    } else if (pdfBuffer) {
      query = `UPDATE personnels SET nom=$1, prenom=$2, fonction=$3, telephone=$4, email=$5, adresse=$6, date_naissance=$7, salaire_base=$8, etat_civil=$9, nbr_enfant=$10, titre_scolaire=$11, option_scolaire=$12, annee_titre_scolaire=$13, titre_academique=$14, filiere_academique=$15, annee_titre_academique=$16, autres_formations=$17, dossier_pdf=$18, cours_dispenses=$19, autres_roles=$20 WHERE id=$21 RETURNING *`;
      values = [nom, prenom, fonction, telephone, email, adresse || null, date_naissance || null, salaire_base || null, etat_civil || null, nbr_enfant || 0, titre_scolaire || null, option_scolaire || null, annee_titre_scolaire || null, titre_academique || null, filiere_academique || null, annee_titre_academique || null, autres_formations || null, pdfBuffer, cours_dispenses || null, autres_roles || null, id];
    } else {
      query = `UPDATE personnels SET nom=$1, prenom=$2, fonction=$3, telephone=$4, email=$5, adresse=$6, date_naissance=$7, salaire_base=$8, etat_civil=$9, nbr_enfant=$10, titre_scolaire=$11, option_scolaire=$12, annee_titre_scolaire=$13, titre_academique=$14, filiere_academique=$15, annee_titre_academique=$16, autres_formations=$17, cours_dispenses=$18, autres_roles=$19 WHERE id=$20 RETURNING *`;
      values = [nom, prenom, fonction, telephone, email, adresse || null, date_naissance || null, salaire_base || null, etat_civil || null, nbr_enfant || 0, titre_scolaire || null, option_scolaire || null, annee_titre_scolaire || null, titre_academique || null, filiere_academique || null, annee_titre_academique || null, autres_formations || null, cours_dispenses || null, autres_roles || null, id];
    }
    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/personnels/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM personnels WHERE id = $1', [id]);
    res.json({ success: true, message: "Employé supprimé avec succès" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inscriptions-ligne', async (req, res) => {
  const {
    nom, postnom, prenom, classe, cycle, genre,
    date_naissance, nationalite, province, commune, quartier, adresse_physique,
    nom_responsable, telephone_responsable, email,
    pere, profession_pere, mere, profession_mere,
    tuteur, profession_tuteur, ecole_provenance, motif_changement
  } = req.body;

  try {
    const query = `
      INSERT INTO eleves (
        nom, postnom, prenom, classe, cycle, genre,
        date_naissance, nationalite, province, commune, quartier, adresse_physique,
        nom_responsable, telephone_responsable, email,
        pere, profession_pere, mere, profession_mere,
        tuteur, profession_tuteur, ecole_provenance, motif_changement, date_inscription
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 
        $21, $22, $23, NOW()
      ) RETURNING *;
    `;

    const values = [
      nom || '', postnom || '', prenom || '', classe || '', cycle || '', genre || '',
      date_naissance || null, nationalite || '', province || '', commune || '', quartier || '', adresse_physique || '',
      nom_responsable || '', telephone_responsable || '', email || '',
      pere || '', profession_pere || '', mere || '', profession_mere || '',
      tuteur || '', profession_tuteur || '', ecole_provenance || '', motif_changement || ''
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, message: "Inscription enregistrée avec succès !", data: result.rows[0] });
  } catch (err) {
    console.error("Erreur lors de l'inscription en ligne :", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/eleve/:matricule', async (req, res) => {
  const matricule = req.params.matricule.trim();

  try {
    const query = `
      SELECT e.matricule, e.nom, e.postnom, e.prenom, e.classe, 
             p.frais_inscription, p.montant_t1, p.montant_t2, p.montant_t3, p.date_paiement, p.detail
      FROM eleves e
      LEFT JOIN paiements p ON e.id = p.eleve_id
      WHERE e.matricule = $1
    `;
    
    const result = await pool.query(query, [matricule]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Matricule inconnu dans notre établissement." });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erreur lors de la recherche de l'élève:", err.message);
    res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

app.post('/api/ajouter-note', async (req, res) => {
    try {
        const { matricule, matiere, note, sur, coefficient, trimestre, type_evaluation } = req.body;
        const query = `
            INSERT INTO notes (matricule, matiere, note, sur, coefficient, trimestre, type_evaluation) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        await pool.query(query, [matricule, matiere, note, sur, coefficient, trimestre, type_evaluation]);
        res.status(200).json({ success: true, message: "Note enregistrée avec succès !" });
    } catch (error) {
        console.error("Erreur lors de l'insertion de la note :", error);
        res.status(500).json({ success: false, error: "Erreur serveur lors de l'enregistrement." });
    }
});

app.get('/api/notes/:matricule/:trimestre', async (req, res) => {
    try {
        const { matricule, trimestre } = req.params;
        const query = `
            SELECT matiere, note, sur, coefficient, type_evaluation, trimestre 
            FROM notes 
            WHERE matricule = $1 AND trimestre = $2 
            ORDER BY matiere;
        `;
        const result = await pool.query(query, [matricule, trimestre]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur lors de la récupération des notes :", error);
        res.status(500).json({ success: false, error: "Erreur serveur." });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { note, sur, coefficient, trimestre, type_evaluation } = req.body;
        const query = `
            UPDATE notes 
            SET note = $1, sur = $2, coefficient = $3, trimestre = $4, type_evaluation = $5 
            WHERE id = $6 RETURNING *;
        `;
        const result = await pool.query(query, [note, sur, coefficient, trimestre, type_evaluation, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Note introuvable." });
        }
        res.status(200).json({ success: true, message: "Note modifiée avec succès !", data: result.rows[0] });
    } catch (error) {
        console.error("Erreur lors de la modification :", error);
        res.status(500).json({ success: false, error: "Erreur serveur." });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM notes WHERE id = $1', [id]);
        res.status(200).json({ success: true, message: "Note supprimée avec succès !" });
    } catch (error) {
        console.error("Erreur lors de la suppression :", error);
        res.status(500).json({ success: false, error: "Erreur serveur." });
    }
});

app.delete('/api/notes/eleve/:matricule', async (req, res) => {
    try {
        const { matricule } = req.params;
        await pool.query('DELETE FROM notes WHERE matricule = $1', [matricule]);
        res.status(200).json({ success: true, message: "Toutes les notes de l'élève ont été supprimées." });
    } catch (error) {
        console.error("Erreur lors de la suppression globale :", error);
        res.status(500).json({ success: false, error: "Erreur serveur." });
    }
});

// Configuration du transporteur d'e-mails
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'jobecadmin@gmail.com',
        pass: 'qldmmxywgepammwa'
    }
});

app.post('/api/contact', async (req, res) => {
    const { nom, email, sujet, message } = req.body;

    const mailOptions = {
        from: email,
        to: 'jobecadmin@gmail.com',
        subject: `[CS JOBEC Contact] ${sujet}`,
        text: `Vous avez reçu un nouveau message depuis le site web.\n\nNom : ${nom}\nE-mail : ${email}\nSujet : ${sujet}\n\nMessage :\n${message}`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true, message: "E-mail envoyé avec succès !" });
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'e-mail :", error);
        res.status(500).json({ success: false, error: "Échec de l'envoi de l'e-mail." });
    }
});

// --- GESTION DE LA BIBLIOTHÈQUE ---

// 1. Récupérer tous les livres de la bibliothèque
app.get('/api/bibliotheque', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bibliotheque ORDER BY date_ajout DESC');
        res.json(result.rows);
    } catch (error) {
        console.error("Erreur lors de la récupération des livres:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// 2. Publier un document (Gère le fichier PDF local)
app.post('/api/bibliotheque', uploadDisk.single('fichier_pdf'), async (req, res) => {
    try {
        const { titre, auteur, categorie } = req.body;

        let lienFinal = '';
        if (req.file) {
            lienFinal = `/uploads/${req.file.filename}`;
        }

        const query = 'INSERT INTO bibliotheque (titre, auteur, categorie, fichier_url) VALUES ($1, $2, $3, $4) RETURNING *';
        const values = [titre, auteur, categorie, lienFinal];
        
        const result = await pool.query(query, values);

        res.status(200).json({ success: true, message: "Document ajouté avec succès !", livre: result.rows[0] });
    } catch (error) {
        console.error("Erreur serveur bibliotheque :", error);
        res.status(500).json({ error: error.message });
    }
});

// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});