<div align="center">

<img src="assets/logo.svg" width="110" alt="Logo Emuglob">

# EMUGLOB

**Ta bibliothèque de jeux rétro, dans un seul lanceur.**

Une bibliothèque de jaquettes, tes émulateurs intégrés dans la fenêtre, tes succès RetroAchievements et tes sauvegardes au même endroit.

Windows 10 / 11 · 64 bits · en français et en anglais

[English](README.md) · **Français**

</div>

![Écran d'accueil d'Emuglob](docs/accueil.jpg)

## Ce que fait Emuglob

### Bibliothèque
- Trois dispositions d'accueil : **Roue** (jaquettes en 3D avec reflet), **Étagère** et **Vitrine**. Souris, clavier ou manette.
- Onglet par console, Favoris et Récents, tri (A→Z, temps de jeu, dernier lancement, date d'ajout) et filtre « jamais lancés ».
- Jaquettes trouvées toutes seules (libretro-thumbnails, GameTDB, covers PS1/PS2, RetroAchievements), à plat et recadrées.
- Fiche de jeu : résumé (Wikipédia), année, éditeur, genre, captures, durée de vie, succès RetroAchievements et ton temps de jeu.
- Dossiers surveillés : les nouveaux jeux déposés apparaissent au démarrage.
- Mode hors ligne : jaquettes, badges et infos déjà vus restent disponibles sans internet.

### Jouer
- L'émulateur s'ouvre **dans** la fenêtre d'Emuglob, avec une barre en jeu : volume de l'émulateur, réglages rapides (Dolphin, PCSX2), contrôles, relancer, plein écran.
- Écran de chargement animé : la cartouche ou le disque entre dans une console assortie.
- Temps de jeu, nombre de parties et statistiques dans ton profil.
- Rich Presence Discord (simple on/off).

### RetroAchievements
- Succès, progression et détail de chaque jeu, avec ton propre compte RA.
- **Subsets** : choix au lancement, patch (.xdelta, .bps, .ips) appliqué tout seul, sur toutes les consoles.
- Reconnaissance des jeux par empreinte (cartouches, DS) puis par titre, accents ignorés.
- Succès avec RALibretro, PCSX2, Dolphin et PPSSPP.
- Profil avec cartes et badges, amis et leur activité.

### Émulateurs
- Installation et mise à jour en un clic depuis leur source officielle : **RALibretro** (et ses cores), **PCSX2**, **Cemu**. Choix de la version dans Paramètres, Système.
- Aussi pris en charge : **Dolphin**, **PPSSPP**, **Azahar** (détectés dans le dossier `emulators` à côté d'Emuglob.exe, ou par leur chemin).
- Contrôles et raccourcis modifiables depuis Emuglob (RALibretro, PCSX2, Dolphin, Azahar), au clavier ou à la manette.
- Si un émulateur a disparu (disque débranché, dossier déplacé), Emuglob dit pourquoi et propose de le retrouver ou de le réinstaller.

### Sauvegardes
- Copies automatiques de tes sauvegardes à chaque partie, partagées entre émulateurs quand c'est possible (RetroArch, Cemu…).
- « Retrouver mes sauvegardes » : cherche les sauvegardes déjà présentes sur le PC (dossiers des émulateurs, à côté des ROMs…) et les importe sans toucher aux originales.

### Apparence
- 6 thèmes : Aurore, Néon, OLED, Phosphore, Clair, Pastel. Couleur du fond selon la console, fond ambiant, fond d'écran perso, sons des menus.
- Pensé aussi pour les écrans ultra-larges.

| Thème Néon | Thème Clair |
|---|---|
| ![Thème Néon](docs/theme-neon.jpg) | ![Thème Clair](docs/theme-clair.jpg) |

**Fiche de jeu**

![Fiche de jeu](docs/fiche.png)

## Consoles

| Émulateur | Consoles |
|---|---|
| RALibretro (cores libretro) | NES, SNES, N64, Game Boy / Color / Advance, DS, Mega Drive, Master System, Game Gear, PC Engine, PlayStation, Atari, Neo Geo Pocket, arcade… |
| PCSX2 | PlayStation 2 |
| PPSSPP | PSP |
| Dolphin | Wii, GameCube |
| Azahar | Nintendo 3DS |
| Cemu | Wii U |

D'autres émulateurs peuvent être ajoutés à la main (chemin et arguments dans Paramètres, Émulateurs).

## Installation

1. Télécharge le `.zip` de la dernière [Release](../../releases/latest).
2. Décompresse-le où tu veux (par exemple `C:\Jeux\Emuglob`).
3. Lance `Emuglob.exe`. Un petit tutoriel t'explique le reste.

Les **mises à jour** se font depuis Emuglob (pop-up au lancement, ou Paramètres, Mettre à jour) : seul le fichier `app.asar` de la Release est téléchargé, et son empreinte SHA-256 est vérifiée avant d'être installé.

> **Aucun jeu, BIOS ni clé de console n'est fourni.** Utilise uniquement tes propres sauvegardes de jeux, le BIOS de ta propre console (PS1, PS2) et les clés tirées de ta propre Wii U (Cemu).

## Pour les développeurs

```
npm install
npm start          # lancer depuis les sources
npm run build-info # empreintes SHA-256 vérifiées au démarrage (à faire avant de construire app.asar)
npm run pack       # build Windows dans dist/
```

La configuration de l'utilisateur est dans `%APPDATA%\emuglob-launcher\` (`config.json`, jaquettes, sauvegardes, copies de secours, cache).

## Licence

Emuglob est un logiciel libre sous licence [GPL-3.0](LICENSE) : tu peux l'utiliser, le modifier et le redistribuer, à condition de garder la même licence et de partager le code source de tes modifications.

## Crédits

Emuglob ne contient aucun émulateur. Ceux qu'il installe sont téléchargés depuis leur source officielle et lancés comme des programmes séparés :
[RALibretro](https://github.com/RetroAchievements/RALibretro) (GPL-3.0),
[PCSX2](https://github.com/PCSX2/pcsx2) (GPL-3.0),
[Cemu](https://github.com/cemu-project/Cemu) (MPL-2.0),
[Dolphin](https://dolphin-emu.org) (GPL-2.0+),
[PPSSPP](https://www.ppsspp.org) (GPL-2.0+),
[Azahar](https://azahar-emu.org) (GPL-2.0).
Les cores RALibretro viennent du [buildbot libretro](https://buildbot.libretro.com).

Services utilisés : [RetroAchievements](https://retroachievements.org) (succès, avec ton propre compte), [libretro-thumbnails](https://github.com/libretro-thumbnails), [GameTDB](https://www.gametdb.com) et [xlenore](https://github.com/xlenore) (jaquettes), Discord (Rich Presence).

Logiciels tiers inclus : [7-Zip](https://www.7-zip.org) (`tools/7za.exe`, Igor Pavlov, GNU LGPL), utilisé seulement pour décompresser les émulateurs téléchargés, et [xdelta3](https://github.com/jmacd/xdelta-gpl) (GPL-2.0+) pour les patchs de subsets. Voir `tools/7za-LICENSE.txt` et `tools/xdelta3-LICENSE.txt`.

Emuglob n'est affilié à aucun fabricant de consoles ni à aucun des projets cités. Les noms de consoles appartiennent à leurs propriétaires.
