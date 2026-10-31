# AI-assisted timetable: орнату

Бұл жоба pretrained OpenAI моделін API арқылы қолдануға дайын. Біз модельді
өзіміз үйреткен жоқпыз. Алгоритм үш стратегиямен кесте нұсқаларын құрады,
conflict scanner оларды тексереді, AI әкімшінің мәтін түріндегі қалауларына
қарап жарамды нұсқалардың бірін таңдайды және себебін түсіндіреді.
Ең көп сабақ орналастырылған нұсқалар ғана AI таңдауына жіберіледі.
Бірдей нұсқалар қайталанбайды, сондықтан кейде үштен аз нұсқа болады.
Бұл тәсіл ең жақсы мүмкін кестені табуға кепілдік бермейді.

## 1. API key алу

1. [OpenAI API keys](https://platform.openai.com/api-keys) бетін ашып, аккаунтыңа кір.
2. Жаңа secret key жаса. Кілтті тек өз компьютеріңдегі `.env` файлына енгіз.
3. API аккаунтында қолжетімді баланс және модельге рұқсат болуы керек.
   [API billing](https://platform.openai.com/settings/organization/billing/overview)
   бөлімін тексер. ChatGPT жазылымы API төлемдерін қамтымайды:
   [ресми түсіндірме](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-the-chatgpt-web-and-api-platform).

Кілтті чатқа, скриншотқа, JavaScript файлына немесе GitHub-қа жіберме.
Кілтпен экран бөлісіп тұрған кезде `.env` файлын ашпа.

## 2. VS Code ішінде енгізу

Жоба түбіріндегі `.env` файлын аш. Егер файл жоқ болса, `.env.example` файлын
көшіріп, атын `.env` деп қой. Мазмұны:

```dotenv
OPENAI_API_KEY=YOUR_KEY_HERE
OPENAI_MODEL=gpt-6-luna
```

`YOUR_KEY_HERE` орнына өз кілтіңді қойып, сақта (`Cmd+S`).
`.env` Git арқылы жіберілмеуі үшін `.gitignore` ішіне енгізілген.
Сервердегі environment айнымалылары `.env` мәндерінен басым.
Модельді өзгерткенде Responses API, Structured Outputs және
`reasoning.effort=low` қолдауы бар, аккаунтыңа қолжетімді модель таңда.

## 3. Серверді қайта қосу

Бұрын сервер ашылған Terminal терезесінде `Control+C` бас. Сосын жоба ішінде:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
python run_demo.py
```

Сайт: http://127.0.0.1:8000. Қажет болса қайта login жаса.
Demo `database.sprint3.db` файлын қолданады.

## 4. Нақты AI сұрауын тексеру

1. Admin ретінде AI Generator бетін аш.
2. `AI-assisted` режимін таңда. `AI configured` тек кілт бар екенін білдіреді;
   кілттің дұрыстығы мен модельге рұқсат сұрау кезінде тексеріледі.
3. Қалауды жаз: `Prefer fewer gaps and fewer days on campus.`
4. `Generate Draft` бас. Бұл нақты API сұрауын жібереді және ақылы болуы мүмкін.
5. Нәтижедегі `Generation Method and Candidate Comparison` бөлімін қара:
   модель, таңдалған нұсқа, себеп, tradeoffs және нұсқалардың көрсеткіштері шығады.
6. Coverage мен conflict scan нәтижесін тексер. Барлық сабақ орналаспаса,
   partial draft ретінде қарастыр.

AI-ға қалаулар мәтіні мен нұсқалардың жинақталған көрсеткіштері ғана жіберіледі.
Код мұғалімдердің аты-жөнін, email-дерін, топ атауларын немесе толық DB жазбаларын
жібермейді. Қалау мәтініне жеке деректерді өзің жазсаң, ол мәтінмен бірге жіберіледі.

## Қате болса

- `not configured`: `.env` сақта, серверді қайта қос, бетті жаңарт.
- `rejected the API key`: кілтті жергілікті тексер.
- `quota or rate limit`: API балансын және limits бөлімін тексер.
- `model access`: аккаунтыңда көрсетілген модель қолжетімді екенін тексер.
- `timed out` немесе `Cannot connect`: интернетті тексеріп, қайта әрекет ет.
- `Scheduling data changed`: генерация кезінде деректер өзгерген; қайта генерацияла.

AI қатесі кезінде бұрынғы кесте сақталады. Жүйе автоматты түрде алгоритм режиміне
ауыспайды. API қолданғың келмесе, `Algorithm only` режимін өзің таңда;
онда интерфейс AI қолданылмағанын анық көрсетеді.

## Оқытушыға қысқа түсіндірме

**Қазақша:** «Біз hybrid тәсілін қолданамыз. Greedy heuristic кесте нұсқаларын
құрады. Pretrained AI моделі біздің қалауларымызға сәйкес бір нұсқаны таңдайды.
Одан кейін жүйе hard constraints шарттарын тексеріп, кестені базаға сақтайды.»

**English:** “We use a hybrid approach. A greedy heuristic builds timetable
candidates. A pretrained AI model selects a candidate based on our preferences
and explains its choice. Our system checks the hard constraints before saving.
We did not train the model ourselves.”

Осы сөйлемді нақты AI сұрауы сәтті өткен соң демонстрациямен дәлелде.
Кілтсіз тексерістерде API жауабы mock арқылы берілді: бұл live AI тесті емес.

Ресми құжаттар:
[API quickstart](https://developers.openai.com/api/docs/quickstart),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[model](https://developers.openai.com/api/docs/models/gpt-6-luna).
