Kivro - persistance locale SQLite

Lancement conseille (Windows) :
  lancer start-kivro.bat

Lancement manuel :
  cd "%USERPROFILE%\Documents\Kivro"
  py server\app.py --host 127.0.0.1 --port 8000
Puis ouvrir :
  http://localhost:8000/index.html

Fonctionnement :
- l'interface web et l'API locale sont servies par le meme serveur Python local
- les conversations sont enregistrees dans une base SQLite locale
- la base est stockee dans : data\kivro.db
- les conversations doivent rester disponibles apres fermeture de l'interface et redemarrage du PC

Remarques :
- Ollama reste utilise en local via http://127.0.0.1:11434
- la deconnexion n'efface plus l'historique des conversations
