<!-- translation-of: README.md @ b24beea8a03bc7d2326a3cae2ab64d50ccfff48f -->

# Clockwork

[English](README.md) · **Français**

Un moteur de test Playwright pour Oracle Fusion Cloud qui rattache chaque étape à un libellé visible plutôt qu'à
un sélecteur, et qui se met en pause et apprend la correction quand un libellé change.

**Simon Kreis & Claude.** Réalisé avec l'IA, principalement Claude (Anthropic), qui a contribué en partie ou en totalité au travail. Simon Kreis en est responsable.

> **Complet :** vérifié par 70 contrôles hors ligne. Aucun autre travail n'est prévu ici. Ses concepts se
> poursuivent maintenant dans un successeur piloté par des agents.

> Agents de programmation : commencez par [AGENTS.md](AGENTS.md) et [CONTEXT.md](CONTEXT.md).
> Ce README est le manuel destiné aux utilisateurs, pour écrire et exécuter des blueprints.

Un traducteur dans les deux sens entre ce qu'une personne fait dans un navigateur et un fichier de test portable et lisible,
auquel s'ajoute un moteur qui rejoue ce fichier sur une application web et s'arrête dès que la réalité
s'en écarte. Il fait une capture d'écran de chaque étape et produit un rapport de réussite ou d'échec.

Quand l'application a renommé quelque chose, l'exécution n'échoue pas. Elle **se met en pause sur cet écran**,
vous dit ce qu'elle cherchait, vous laisse faire l'action vous-même, et inscrit votre correction
dans le fichier de test. Le fichier de test est un brouillon ; l'exécution est le compilateur.

Ce qui dure, c'est le blueprint : l'intention d'un test, exprimée par les libellés qu'une personne voit à
l'écran. Il n'y a aucun sélecteur dedans, nulle part, jamais.

Conçu pour Oracle Fusion Cloud, sans y être lié : tout ce qui est propre à l'application tient dans trois
listes de [src/config.ts](src/config.ts).

## Où en est le projet

Lisez ceci avant de juger quoi que ce soit d'autre ici.

Le moteur est vérifié **sur une fausse application construite à cette fin** : 70 contrôles hors ligne
qui couvrent la chaîne de résolution, les cadres, la liste de valeurs, la détection des erreurs, le convertisseur d'exports hérités, le
générateur de rapports, l'éditeur de profils de données et le mode assisté de bout en bout. `npm run check` les exécute
sans identifiants, sans réseau et sans configuration.

Trois comportements d'Oracle Fusion et de son environnement habituel sont traités explicitement, parce qu'une
fausse application n'aurait jamais suffi à les faire apparaître : un navigateur fourni qui ne peut pas démarrer dans une
fenêtre sur un poste de travail géré, un chevron de menu dont le nom accessible ressemble vaguement à celui du menu
lui-même, et une session expirée qui, autrement, se présenterait comme un libellé manquant. Chacun
est couvert par un test.

Donc : le moteur fonctionne, et l'intégration avec Oracle est jeune. Quiconque le prolonge doit s'attendre à ce que les
listes propres à l'application dans `src/config.ts` demandent des ajustements à mesure qu'on parcourt davantage d'Oracle.
Rien dans ce dépôt ne prétend avoir fait ses preuves sur le terrain.

## Le nom

Un jouet à remontoir. Pas un robot, pas un agent, pas un assistant. L'image est venue pendant la conception,
et elle s'est révélée décrire chaque décision de ce projet ; elle est donc devenue le nom :

| Le jouet | Le moteur |
|---|---|
| **De l'énergie emmagasinée.** Tout ce qu'il fera est remonté d'avance. | Un blueprint s'écrit d'abord, et l'exécution ne dépense que ce qu'il contient. |
| **Une ligne droite.** Il n'a pas de direction. | Aucun embranchement conditionnel, jamais. C'est une décision de périmètre définitive, pas une fonction manquante. |
| **Aucune autonomie.** Il ne décide de rien. | Pas d'autoréparation, pas de nouvelles tentatives, pas de supposition sur l'élément que vous visiez probablement. |
| **Un arrêt net au premier obstacle.** Il ne s'agite pas, il ne se renverse pas, il s'arrête. | Une étape qui ne trouve pas son élément interrompt l'exécution et dit exactement ce qu'elle cherchait. Un test bloqué est un résultat valide, pas un défaut. |
| **Vous le prenez et le remettez sur sa trajectoire.** | Le mode assisté : le navigateur vous attend sur l'écran en échec, et vous faites l'action vous-même. |

Et la seule chose qu'un vrai jouet à remontoir ne sait pas faire, qui est toute la raison d'être de ce moteur : **il
retient la correction.** Ce que vous avez fait à la main est inscrit dans le fichier de test, si bien que l'exécution suivante
ne s'arrête plus là.

Tout ce qui lui permettrait de contourner un obstacle de lui-même est hors du périmètre, définitivement. C'est
à cela que sert le nom : il rend la limite facile à retenir, et facile à invoquer pour dire non.

## Pour commencer

```bash
npm install
npm run install:browsers
```

Vérifiez que le moteur lui-même fonctionne, sans environnement Oracle et sans identifiants :

```bash
npm run selftest
```

Cela exécute 70 contrôles : un faux Oracle met le moteur à l'épreuve de bout en bout (navigation, une liste de valeurs
avec une liste de suggestions asynchrone, une liste déroulante simple, un champ dans une iframe, un champ en lecture seule,
la détection des erreurs, le mode assisté), et un export hérité synthétique met le convertisseur à l'épreuve. Si tout est vert,
ce qui casse plus tard est propre à Oracle, pas au moteur.

Pointez-le ensuite vers un environnement réel. Lancez Clockwork une première fois avec `Clockwork.cmd` sous Windows, qui
demande avant de créer son espace de travail, ou créez celui-ci vous-même avec `npm run init` : il se place à côté de ce
dossier, `../clockwork-workspace/`, avec un `.env` commenté à l'intérieur. Remplissez-y une seule chose :

- `ORACLE_BASE_URL`, un pod de DEV ou de TEST. Le moteur refuse de démarrer sur un pod de production.

Puis relancez-le. Tout ce qui vous est propre vit dans cet espace de travail : la configuration, vos
scénarios, leurs données, et le journal, les captures d'écran et le rapport de chaque exécution. Ce dossier contient
l'application et rien d'autre, si bien qu'on peut le copier, le partager ou le publier tel quel. Il n'y a aucun
mot de passe à remplir. Voir la section suivante.

## Si vous préférez ne pas utiliser de terminal

Sous Windows, double-cliquez sur `Clockwork.cmd` dans ce dossier. Ou, depuis un terminal :

```bash
npm run gui
```

Une page s'ouvre à `http://127.0.0.1:4400/`, dans votre navigateur par défaut. Elle fait ce que décrit le reste de ce
manuel : choisir un scénario, remplir les données dont il a besoin, l'exécuter, regarder défiler les étapes, ouvrir
le rapport. Elle n'écoute que sur votre propre machine. `Clockwork.cmd` installe ce qu'il faut la première
fois ; ensuite, la fenêtre qu'il ouvre est le serveur : gardez-la ouverte pendant que vous travaillez, fermez-la pour arrêter
Clockwork.

C'est une porte d'entrée, pas un autre outil : elle lance les mêmes commandes que celles documentées plus bas et lit le même
journal d'exécution, si bien qu'une exécution lancée là et une exécution lancée dans un terminal sont la même exécution. La supervision
d'un test en cours ne change pas, et c'est délibéré : quand une étape ne trouve pas son élément, le navigateur
reste ouvert sur cet écran avec un bandeau, et c'est là que vous travaillez, pas ici.

Il n'y a aucun champ de mot de passe sur cette page. Vous vous connectez dans la fenêtre de navigateur propre à l'exécution, comme le décrit la
section suivante.

Trois interrupteurs valent la peine d'être connus. **Pause and let me help** est activé par défaut, et c'est le produit.
**Slow down so I can follow** marque une brève pause après chaque étape, pour que vous voyiez ce que fait le moteur.
**Hide the browser** sert à une exécution que personne ne regarde ; comme une exécution masquée ne peut pas se connecter, il n'est
disponible qu'avec `SESSION=saved`.

## La connexion

Chaque exécution commence sur la page de connexion de votre pod, dans une fenêtre de navigateur qui lui est propre. **C'est vous** qui vous y connectez,
à la main, second facteur compris. L'exécution remarque d'elle-même que vous êtes connecté, et le scénario
démarre dans cette même fenêtre : vous le voyez de la connexion jusqu'à la dernière étape. Quand la fenêtre se ferme,
rien de la session n'est conservé.

Cette fenêtre est votre navigateur par défaut s'il est basé sur Chromium : Chrome, Edge, Brave, Vivaldi ou
Opera. Firefox et Safari ne peuvent pas être pilotés ; un autre navigateur Chromium installé est alors utilisé à leur place,
et un navigateur qui ne peut pas démarrer le dit et énumère ceux qui sont pris en charge. Dans tous les cas, l'exécution utilise
un profil temporaire neuf : pas vos onglets, pas vos mots de passe enregistrés, pas vos extensions.

Pourquoi cela fonctionne ainsi :

- aucun mot de passe ne touche jamais ce dépôt, un fichier de configuration ou un test
- l'authentification multifacteur cesse d'être un problème, parce qu'une personne y répond
- un blueprint commence à sa première action réelle, sans étapes de connexion à entretenir
- il n'y a aucune session enregistrée qui puisse expirer, fuir ou semer la confusion : chaque exécution commence par vous

Une exécution dont le navigateur est masqué ne peut pas vous demander de vous connecter, et s'arrête aussitôt en le disant. Pour ces
exécutions seulement, enregistrez une fois une session dans un fichier et réglez `SESSION=saved` dans le `.env` de l'espace de travail :

```bash
npm run auth
```

Ce fichier contient des cookies de session actifs : il est exactement aussi sensible que le mot de passe. Il est ignoré par Git,
et il ne quitte jamais votre machine.

## Lancer les tests

```bash
npm test                              # every blueprint in blueprints/
npm run test:one -- "create_a_course" # one of them
npm run ui                            # Playwright's UI mode: the supervision screen
npm run report                        # summary and evidence document of the last run
npm run evidence -- --layout stack    # the evidence document alone, one column
```

Les exécutions se font **avec fenêtre** par défaut : le mode assisté a besoin d'une fenêtre dans laquelle vous pouvez agir. Réglez `HEADLESS=true` dans
`.env` pour une exécution que personne ne regarde, ainsi que `ASSIST=false`, pour qu'un libellé erroné fasse échouer l'exécution
au lieu d'attendre indéfiniment une personne qui n'est pas là.

Pour exécuter plusieurs scénarios à la fois, réglez `WORKERS` dans `.env`. Trois à cinq, c'est réaliste pour une seule
personne qui supervise. La limite n'est pas la machine : deux scénarios qui créent le même objet dans le
même environnement entrent en collision ; un lot parallèle doit donc être composé de scénarios indépendants.

Les rapports arrivent dans l'espace de travail, `../clockwork-workspace/reports/` :

| Fichier | Ce que c'est |
|---|---|
| `journal-<run>.jsonl` | Un enregistrement par étape. L'artefact durable : tous les autres rapports en sont générés. |
| `summary-<run>.md` et `.html` | Le résumé des réussites et des échecs, pour qui exécute les tests : détails de résolution, réparations, échecs. |
| `evidence-<run>.html` et `.pdf` | Le document pour qui reçoit les tests : une étape, une capture d'écran, regroupées par billet. Côte à côte par défaut, sur une colonne avec `--layout stack`, et le HTML permet de passer de l'un à l'autre. Captures d'écran intégrées : on peut l'envoyer par courriel sans risque. |
| `screenshots/<run>/` | Une image par étape. |
| `playwright-html/` | Le rapport propre à Playwright, avec une trace rejouable de toute l'exécution. |

## Quand une étape ne trouve pas son élément

C'est la façon normale dont un test termine sa première vie, pas un accident.

1. L'exécution s'arrête à cette étape et **laisse le navigateur ouvert sur l'écran en échec**.
2. Un bandeau apparaît en haut de cette page : quelle étape, quel libellé elle voulait, et tous les libellés
   qui sont effectivement sur la page à ce moment.
3. Faites l'action vous-même, dans cette fenêtre. Le moteur observe ce sur quoi vous cliquez.
4. Appuyez sur **Resume**. Il vous dit ce qu'il a capté, inscrit ce libellé dans le fichier du blueprint, et
   continue à l'étape suivante.

Vous pouvez aussi cliquer sur l'un des libellés du bandeau pour le choisir directement, ou appuyer sur **Stop this
test** pour mettre fin à l'exécution et obtenir un résultat rouge ordinaire.

Deux conséquences à connaître :

- L'exécution continue à l'étape **suivante**. Elle ne répète pas l'action que vous venez de faire à la main,
  parce que ce serait cliquer deux fois sur Enregistrer.
- Un blueprint n'a donc pas besoin d'être juste au moment où on l'écrit. Dix lignes approximatives
  en langage courant, exécutées et réparées au fur et à mesure, sont une façon légitime d'écrire un test.

Quand plusieurs tests tournent à la fois, chacun se met en pause dans sa propre fenêtre, et c'est là qu'on le fait repartir. C'est pourquoi
il n'y a pas de tableau de bord : utilisez `npm run ui` pour voir la liste, et la fenêtre en pause elle-même pour le corriger.

## Écrire un test

Partez de `templates/blueprint-template.yaml` dans votre espace de travail : copiez-le dans `blueprints/`
sous un nouveau nom. Rien de ce qui se trouve dans `templates/` n'est jamais exécuté.

Un blueprint est un fichier YAML dans `<workspace>/blueprints/`. Déposez-y un fichier, il s'exécute. Il n'y a aucun code
à écrire.

```yaml
scenario: create_a_course
source: PROJ-1234          # the ticket, for traceability
data_profile: learning_sample_default

steps:
  - action: navigate
    path: ["Navigator", "My Client Groups", "Learning", "Courses"]

  - action: click
    label: "Create"

  - action: fill
    label: "Title"
    value: "{{title}}"

  - action: select               # a list of values: types, picks the option, checks the field
    label: "Category"
    value: "HR"

  - action: click
    label: "Save and Close"

  - action: verify
    text_contains: "was created"
```

Pas de connexion, pas de déconnexion, pas de persona. **Un test, c'est une personne, dans une session, de A à Z.** Un
scénario hérité à quatre personnes devient quatre blueprints, exécutés dans l'ordre par un humain.

### Les dix mots-clés

| Mot-clé | Ce qu'il fait |
|---|---|
| `navigate` | Parcourt un chemin de menu : `path: ["Navigator", "My Team", "Learning"]`. Ou saute à une `url:`. |
| `click` | Clique sur un bouton, un lien ou une entrée de menu par son libellé visible. `double: true` pour un double-clic. |
| `fill` | Saisit du texte dans un champ. Ajoutez `press_enter: true` pour une zone de recherche. |
| `select` | Une liste de valeurs : saisit, attend la liste, choisit l'option, puis vérifie que le champ la contient vraiment. `mode: dropdown` pour une simple liste de choix qu'on ouvre plutôt que d'y saisir du texte. |
| `press_key` | Une touche : `key: "Tab"`. Ajoutez un `label:` pour la diriger d'abord vers un champ. |
| `capture` | Lit un champ en lecture seule dans une variable : `as: course_number`, réutilisée plus loin sous la forme `{{course_number}}`. |
| `verify` | Vérifie la valeur d'un champ (`label` plus `equals` ou `contains`) ou la page (`text_contains`). |
| `wait_for` | Attend que quelque chose apparaisse ou disparaisse. Rarement nécessaire : l'attente est automatique. |
| `switch_window` / `close_window` | Pour les notifications d'approbation qui ouvrent une fenêtre surgissante. |
| `refresh` | Recharge la page. |

L'exemple complet, qui est aussi un fichier de test, et ne peut donc jamais devenir périmé, est
[selftest/blueprints/selftest_create_course.yaml](selftest/blueprints/selftest_create_course.yaml).

### Les données

Les valeurs viennent d'un profil dans `data/`, référencées sous la forme `{{name}}`. Il n'y a aucun mot de passe dans un
blueprint ou un profil, et nulle part où en mettre un.

Des générateurs sont disponibles pour les valeurs qui doivent être uniques à chaque exécution ; ils remplacent le code personnalisé de la plateforme héritée :
`{{random_string(6)}}`, `{{random_number(4)}}`, `{{today()}}`, `{{today(1)}}`, `{{today_us()}}`,
`{{timestamp}}`.

### Quand le même libellé apparaît deux fois

Ajoutez un indice. Rien d'autre, et jamais un sélecteur.

```yaml
  - action: click
    label: "Next"
    hints:
      section: "Add a Person"    # restrict to a named panel or dialog
      index: 1                   # or take the second match, counting from zero
```

Le rapport signale chaque étape où un libellé a correspondu à plusieurs éléments ; vous les trouvez donc sans
avoir à les chercher.

### Les cadres

Il n'y a rien à écrire. Une page intégrée dans une page (BI Publisher, régions ADF classiques) est
explorée automatiquement, après le document principal. La plateforme héritée change de cadre par son numéro d'ordre et casse le jour où
Oracle en ajoute un ; ici, le blueprint ne mentionne jamais les cadres.

## Convertir un export hérité

```bash
npm run convert                       # reads <workspace>/legacy-exports
npm run convert -- <exportDir> <outDir>
```

Il assemble les trois fichiers hérités et écrit des blueprints. Quand le XPath d'origine contient un libellé
visible, ce libellé est utilisé. Quand il n'en contient pas, ce qui est le cas la plupart du temps, le libellé est deviné à partir du
nom de l'objet hérité et marqué d'un commentaire `# INFERRED` : la première exécution vous dira si
la supposition était juste, et vous laissera la corriger sur-le-champ.

Un scénario qui se connecte successivement sous l'identité de plusieurs personnes devient plusieurs blueprints, `_1`, `_2`, `_3`,
à exécuter dans l'ordre. Ce que le convertisseur refuse de traduire (code personnalisé, reconnaissance d'image,
embranchement conditionnel, un verbe qu'il n'a jamais vu) est inscrit dans le fichier sous forme de commentaire plutôt que
supprimé, si bien qu'il ne manque jamais discrètement une action à un blueprint. Tout ce qui mérite un second regard est
énuméré dans `reports/conversion-report.md`.

**Avant d'exporter depuis la plateforme héritée, assurez-vous que les scénarios sont actifs.** Un scénario mis en commentaire dans la plateforme héritée
exporte ses étapes mais aucun de ses localisateurs ; l'export paraît donc complet et ne l'est pas.

## Pourquoi il n'y a de sélecteur nulle part

La chaîne de résolution est :

```
visible label -> ARIA role and name -> title -> placeholder -> adjacent text -> hints
```

et ensuite, elle s'arrête et vous demande. Il n'y a pas de XPath hérité en dernier recours. Il permettrait au moteur de
« ne jamais faire pire que la plateforme héritée », mais seulement avec un référentiel d'objets complet tiré de la
plateforme héritée, et c'est impossible : les exports portent 302 références d'objets et pas un seul XPath.
Un filet de sécurité toujours vide coûte quand même un champ de schéma, un chemin de code et un concept.

La conséquence est délibérée. Une étape dont le libellé est erroné échoue désormais immédiatement au lieu de fonctionner
discrètement sur un sélecteur qui se dégradera au prochain correctif d'Oracle. En mode assisté, c'est une
qualité : le travail apparaît tout de suite, devant quelqu'un qui peut le corriger en dix secondes.

## Ce que ce moteur ne fait pas, délibérément

Pas d'autoréparation, pas de nouvelles tentatives, pas de planification, pas d'historique des exécutions, pas d'embranchement conditionnel, pas de tableau de bord.
Il ne peut pas tester une chaîne d'approbation à quatre personnes en une seule exécution, et il ne peut pas tourner sans surveillance pendant la nuit : un
test bloqué attend une personne. Chacun de ces choix est la contrepartie d'un moteur qu'une seule personne peut construire,
comprendre et entretenir. Voir [CONTEXT.md](CONTEXT.md) pour le raisonnement.

## Organisation du dépôt

Rien de propre à un utilisateur ou à un mandat ne se trouve ici. Tout vit dans l'espace de travail à côté de ce
dossier, `../clockwork-workspace/`, que Clockwork trouve sans aucune configuration, et que `npm run init`
crée une seule fois, à dessein : `.env`, `blueprints/`, `data/`, `legacy-exports/`, `templates/` et `reports/`. Voir son propre
README. Cette séparation est ce qui garde ce dossier anonyme, réutilisable et publiable.

```
src/
  locate.ts        the resolution chain. The heart of the project.
  assist.ts        the pause, the banner, the click capture, the file repair
  interpreter.ts   walks the steps, screenshots, journals
  keywords/        one module per action
  blueprint.ts     loading and strict validation of a blueprint
  types.ts         the blueprint schema, v0.2
  data.ts          data profiles, references and generators
  journal.ts       the run journal, one JSON record per step
  context.ts       the state a keyword handler works with
  errors.ts        Oracle error detection
  config.ts        every tuning point, including the production guard
  browser.ts       which browser to drive when nobody said
  profile.ts       reading and editing a data profile as text, comments intact
  workspace.ts     finds, loads and creates the workspace
tests/
  blueprints.spec.ts  one Playwright test per blueprint of the workspace
tools/
  capture-session.ts  npm run auth, for SESSION=saved (hidden runs) only
  convert-legacy.ts   legacy export to blueprints
  report.ts           journal to summary, then calls evidence.ts
  evidence.ts         journal to evidence document, HTML and PDF: content, markup, layout
  split-legacy-paste.ts  a page copied out of the legacy interface, back into .feature files
  gui/                npm run gui: a loopback server and one page, over the tools above
selftest/          the fake Oracle, a synthetic legacy export, and the offline suite
docs/RECORDING.md  repairing a step in the browser, and writing a new one
CONTEXT.md         the decision record: what is settled, and why
.claude/skills/    first live run, converting a legacy export, verifying offline (mirrored in .agents/)
Clockwork.cmd      double click launcher for the local interface, on Windows
```

## Licence

MIT. Voir [LICENSE](LICENSE). Copyright 2026 Simon Kreis. Contact : Simon Kreis, M. Sc., [simon@kreisconsulting.ca](mailto:simon@kreisconsulting.ca).

Rien de ce qui provient d'un client ne se trouve dans ce dépôt, par construction : les scénarios, les profils de données et les exports
bruts vivent dans un répertoire d'espace de travail situé hors du dépôt. Tout ce qui, ici, ressemble à un système réel est
synthétique, y compris le faux Oracle sous `selftest/` et l'export d'exemple qui l'accompagne.
