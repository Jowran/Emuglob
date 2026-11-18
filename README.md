# Emuglob

Lanceur Windows (Electron) pour gérer une bibliothèque de ROMs et d'émulateurs (RALibretro et autres).

## Fonctions
- Bibliothèque de jeux avec jaquettes (libretro-thumbnails, GameTDB)
- Intégration RetroAchievements (clé API à saisir dans les paramètres)
- Gestion des sauvegardes, hash de ROMs, identification de disques
- Rich Presence Discord (automatique, simple on/off)
- Vérification au démarrage : message clair si un fichier manque, est mal nommé ou abîmé (app.asar, fichiers Electron, config.json, émulateurs)
- Contrôles et raccourcis des émulateurs modifiables dans Emuglob (RALibretro, PCSX2, Dolphin, Azahar), capture clavier ou manette, copie .bak avant écriture
- Installation et mise à jour de RALibretro et PCSX2 en un clic depuis Emuglob (Paramètres, Installation), et détection des émulateurs posés dans le dossier `emulators\` à côté d'Emuglob.exe
- Recherche des sauvegardes déjà présentes sur le PC (dossiers des émulateurs, à côté des ROMs) et import par copie, sans toucher aux originaux

## Lancer
```
npm install
npm start
```

## Build Windows
```
npm run pack
```
Le build sort dans `dist/`.

## Config
La config utilisateur est dans `%APPDATA%\emuglob-launcher\config.json`. Aucun émulateur ni ROM n'est inclus.

## Avant de construire app.asar
```
npm run build-info
```
Écrit `build-info.json` (date + empreintes SHA-256). Au lancement, `boot.js` s'en sert pour signaler un fichier abîmé.

## Crédits
Emuglob ne contient aucun émulateur. [RALibretro](https://github.com/RetroAchievements/RALibretro) (GPL-3.0, RetroAchievements) et [PCSX2](https://github.com/PCSX2/pcsx2) (GPL-3.0) peuvent être installés depuis Emuglob : ils sont alors téléchargés directement depuis leur source officielle (site de RetroAchievements, Releases GitHub de PCSX2) et lancés comme des programmes séparés. Les cores de RALibretro sont téléchargés à la demande depuis le buildbot officiel de libretro (buildbot.libretro.com). Aucun BIOS n'est fourni.

Logiciels tiers inclus : [7-Zip](https://www.7-zip.org) (`tools/7za.exe`, Igor Pavlov, GNU LGPL), utilisé seulement pour décompresser les émulateurs téléchargés. Voir `tools/7za-LICENSE.txt`.
