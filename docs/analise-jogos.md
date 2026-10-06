# Análise do vídeo: jogos a replicar

Vídeo de 10:29. De 0:00 a 2:12: LinkedIn Jogos (Queens, Tango, Mini Sudoku, Zip, Patches). De 2:12 a 10:29: Futbol11
(Statdle, Top 10, Grid, Connections, Bingo, Goltexto, Legacy). Analisado a 1 imagem por segundo, com zoom nas transições.

## 1. O que está por trás

**LinkedIn**
- Um puzzle por dia, igual para todos e numerado (Queens #889). Só se joga uma vez, o que cria escassez e hábito.
- Lógica pura com uma única solução: "Só há uma resposta certa e não precisa adivinhar". Conta o tempo, não há vidas.
- Os erros ensinam em vez de castigar. A regra violada aparece logo: tracejado vermelho na linha, coluna ou região
  inteira, mais uma mensagem por regra ("Epa. Cada linha pode ter apenas uma ♛") com o link "Mostre-me".
- Entrada progressiva: no "Dia 1 de 2" os tabuleiros eram pequenos (Queens 7×7, Tango 4×4 sem sinais) e o ranking das
  ligações estava desfocado com "Jogue amanhã para acessar a classificação". Isto puxa o jogador para o 2.º dia.
- A vitória tem uma animação curta (coroas douradas, brilho no Tango, "escadinha" no Sudoku) e depois abre os resultados.
- A página de resultados é igual em todos os jogos; só mudam a cor e o ícone. Tem:
  - o tempo e uma frase ("Você aprende rápido.");
  - uma comparação ("28% dos novos jogadores não conseguiram resolver este jogo");
  - Publicar / Enviar / Copiar;
  - o ranking das ligações, só de quem aceita participar;
  - estatísticas: partidas, % de vitórias, melhor tempo e sequência máxima;
  - a semana com os dias jogados, selos e lembrete diário;
  - um vídeo de especialista e "Conheça outros jogos".
- Na página de Networking há uma faixa com cada jogo, a sequência de dias e o botão "Resultados".

**Futbol11**
- Trivia de futebol em cima de uma base de dados de jogadores: carreira, clubes, seleções, estatísticas, troféus e fotos.
- Todos os jogos têm o mesmo esqueleto:
  - cartão de introdução com as regras, o modo ou temporizador e "Start Game";
  - escrever o nome com autocompletar e tentativas limitadas ou temporizador;
  - bandeira para desistir, com confirmação, e a resposta revelada no fim;
  - janela de estatísticas com histograma;
  - registo global de vitórias–derrotas no topo e ✓ no cartão do jogo ganho.

## 2. Jogo a jogo

### Queens (LinkedIn)
- **Regras:** uma ♛ por linha, coluna e região de cor, sem se tocarem, nem na diagonal. Um toque põe ✕, dois toques põem ♛.
- **Por trás:** é uma variante do "Star Battle". O tabuleiro tem uma única solução e resolve-se só por dedução.
- **UX vista:**
  - Desfazer, Dica, Redefinir (com confirmação), "Como jogar", carrossel de "Exemplos" e tutorial no "?".
  - Erros com tracejado e mensagem por regra.
  - Na vitória as coroas ficam douradas, o tabuleiro bloqueia cerca de 1 s e abrem-se os resultados.
  - O tempo não aparecia durante o jogo.
- **Na nossa app:** já temos solução única, dificuldade padronizada, ✕ por arrasto, Desfazer, Limpar e Dica. Falta o
  tracejado com mensagens e "Mostrar", a confirmação ao limpar e a animação de vitória.

### Tango (LinkedIn)
- **Regras:** preencher com ☀ e 🌙, no máximo 2 iguais seguidos, o mesmo número de cada em cada linha e coluna. `=` quer dizer iguais e `×` diferentes.
- **Por trás:** é o "Takuzu" com sinais. No dia 1 deram um 4×4 sem sinais; o normal é 6×6.
- **UX vista:** as casas dadas têm fundo bege e cursor 🚫. Cada toque alterna vazio → ☀ → 🌙. Na vitória passa um brilho na diagonal.
- **Na nossa app:** já temos 6×6 com sinais e dedução garantida. Faltam as mensagens por regra e a animação.

### Mini Sudoku (LinkedIn)
- **Regras:** grelha 6×6 com caixas 2×3; os números 1–6 uma vez por linha, coluna e caixa.
- **UX vista:**
  - Ecrã de boas-vindas na 1.ª visita.
  - Teclado 1–6 com Apagar e Desfazer, e um modo "Notas" (lápis).
  - Um número fica desativado quando os 6 já estão no tabuleiro.
  - Selecionar uma casa pinta a linha, a coluna e a caixa; números repetidos levam tracejado vermelho.
  - Na vitória uma "escadinha" cobre o tabuleiro.
- **Na nossa app:** faltam as notas, desativar números completos, o destaque e a animação.

### Zip (LinkedIn)
- **Regras:** um único caminho que passa pelos números por ordem e enche todas as casas.
- **UX vista:** caminho largo com cantos redondos e cor em gradiente (vermelho no 1, laranja no fim). Tempo visível no topo.
- **Na nossa app:** já temos paredes e caminho único. Faltam o gradiente e o caminho largo.

### Patches (LinkedIn), jogo novo
- **Regras:** estão no ecrã do jogo. Divide-se a grelha em retângulos e cada um tem exatamente uma pista. A pista diz a
  forma (quadrado, retângulo vertical, horizontal ou qualquer) e, se tiver número, a área.
- **Por trás:** é o "Shikaku" com formas. Gera-se uma divisão em retângulos e põe-se uma pista em cada; depois esconde-se
  informação enquanto a solução continuar única e dedutível.
- **UX vista:** só se viu o jogo já resolvido, com os retângulos coloridos. Desenha-se arrastando o dedo.

### Pistas (Futbol11 "Statdle")
- **Regras:** a liga e a época estão sempre visíveis. Cada erro ou "Skip" revela 2 de 8 dados: jogos, golos,
  assistências, posição, país, idade, valor e clube. Há 5 tentativas e na última o botão passa a "Give up".
- **Problema:** os dados saem ao acaso, por isso a primeira pista pode não servir para nada.
- **Na nossa app:** a mesma mecânica, garantindo que o conjunto de pistas só aponta para um jogador.

### Top 10 (Futbol11)
- **Regras:** completar os 10 nomes de uma lista ordenada (ex.: "PSG 2013/14 – mais jogos"), com a bandeira de cada um como pista.
- **Problema:** errar não custa nada, por isso tenta-se ao calhas até acertar. Desistir revela a lista.
- **Na nossa app:** limite de erros e uma pista útil por linha. Nas listas de uma só seleção a bandeira não ajuda.

### Grelha (Futbol11 "Grid")
- **Regras:** grelha 3×3 em que linhas e colunas são clubes ou seleções; cada casa leva um jogador que cumpra as duas.
  Se o jogador couber em várias casas escolhes; se só couber numa entra sozinho; se não couber diz
  "There's no place for X". Desistir mostra respostas possíveis.
- **Na nossa app:** cada casa tem um número mínimo de respostas (o padrão de dificuldade) e mostra-se quão rara foi a tua resposta.

### Ligações (Futbol11 "Connections")
- **Regras:** 16 jogadores em 4 grupos de 4 (ex.: "Jogou no Ajax"). Escolhes 4 e submetes; se acertares 3 de um grupo
  aparece "You have found 3 correct players of a group".
- **Problema:** as cores dos grupos alternam sem significado.
- **Na nossa app:** cor por dificuldade, 4 vidas e cada jogador só cabe num grupo (solução única).

### Bingo (Futbol11)
- **Regras:** 12 categorias em 3×4 (clubes, países, troféus, ligas). Aparece um jogador de cada vez: clicas na categoria
  certa ou fazes "Skip". Errar faz a casa piscar a vermelho e perde-se esse jogador. Há 90 s.
- **Na nossa app:** a sequência garante que as 12 casas são possíveis e o tempo conta no servidor.

### Quente ou Frio (Futbol11 "Goltexto")
- **Regras:** adivinhar o jogador secreto. Cada palpite recebe uma pontuação de semelhança, que pode ser negativa.
- **Problema visto:** a pontuação não diz porquê. Foste pesquisar ao Google ("spanish players in premier league") e
  acabaste por desistir; era o Bukayo Saka.
- **Na nossa app:** cada palpite mostra o que bate (país, posição, liga, clubes em comum, idade ↑↓), além da pontuação.

### Quem Sou Eu (Futbol11 "Legacy")
- **Regras:** "Joguei nestes 4 clubes. Quem sou eu?" Começa com 1 clube e cada erro ou "Skip" revela o seguinte.
  Perde-se depois do 4.º (ex.: Fabinho: Monaco, Real Madrid, Liverpool, Al Ittihad).
- **Na nossa app:** garantir que só um jogador da base passou por aqueles 4 clubes.

## 3. Problemas de UX a não repetir
- **Futbol11:**
  - dois anúncios fixos tapam metade do ecrã e fazem o layout saltar;
  - os avisos aparecem em cinzento pequeno ("It's not Silva");
  - o registo vitórias–derrotas do topo mistura todos os jogos;
  - cada jogador escolhe o modo, por isso os resultados não são comparáveis.
- **LinkedIn:** Queens e Tango não mostravam o tempo durante o jogo e Zip e Patches mostravam. É inconsistente.

## 4. Dados para os jogos de futebol
- **Fonte:** Wikidata, com licença CC0, que deixa usar os dados livremente. Tem cerca de 6.200 jogadores com artigo em
  30+ Wikipédias, com clubes, datas, jogos e golos por clube, seleção, posição, data de nascimento e altura.
- **Verificado com as respostas do vídeo:**
  - Kim Min-jae no Fenerbahçe 2021–22: 31 jogos e 1 golo, igual ao Statdle;
  - Fabinho: Monaco, Real Madrid, Liverpool, Al Ittihad, igual ao Legacy.
- **Limites:**
  - não tem assistências nem valor de mercado (o Transfermarkt não é aberto);
  - os números são por passagem no clube, não por época;
  - há alguns erros, que se filtram.
- **Imagens:** fotos de jogadores e emblemas de clubes têm direitos de imagem e de marca. Usamos uma camisola desenhada
  com as cores do clube, bandeiras e iniciais.

## 5. Ordem de implementação
1. Melhorias de UX do LinkedIn nos 4 jogos atuais e uma página de resultados igual para todos.
2. Patches.
3. A base de dados de futebol e os 7 jogos.
