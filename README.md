# Emuglob

Lanceur Windows (Electron) pour gérer une bibliothèque de ROMs et d'émulateurs (RALibretro et autres).

## Fonctions
- Bibliothèque de jeux avec jaquettes (libretro-thumbnails, GameTDB)
- Intégration RetroAchievements (clé API à saisir dans les paramètres)
- Gestion des sauvegardes, hash de ROMs, identification de disques
- Rich Presence Discord (ID d'application dans les paramètres)

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
