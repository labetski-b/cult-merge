import{Y as ue,Z as I,B as v,c as de,k as fe,_ as me,N as j,S as pe,M as ge,$ as H,a0 as he,a1 as ve}from"./SimulationEngine-C0V7kTN9.js";const be="/cult-merge/assets/2026-05-17-baseline-quest-sequence-kl50-Czj1VCDB.json",A="cult-merge-autoquest-scoring-debug-settings-v1",W=10,B=-me,ye=2e3,z=42,Se=[["lineNovelty","novel"],["lineFreshness","line fr"],["questFreshness","quest fr"],["lineExposure","exposure"],["budgetUse","budget"],["fieldSupport","field"],["level","lvl"]],q={sacrificesRequired:5,questsPerKrakenLevelLimit:2,expectedTicksByDifficulty:[[1,0],[2,2],[3,4],[4,8],[5,8]]},P=[{reason:"NC",id:"no_generator_capacity",condition:"totalL1Capacity <= 0",effect:"Строка недостижима: нет существ этой линии на поле и генератор не дает L1-capacity в текущем budget/window."},{reason:"OB",id:"over_budget",condition:"requiredL1 > totalL1Capacity",effect:"Стоимость квеста в L1-эквиваленте выше текущей емкости: fieldL1 + spawnL1Capacity."},{reason:"SM",id:"over_seen_max_plus_one",condition:"level > min(creature.maxLevel, seenMax + 1)",effect:"Запрещает скачок выше следующего открываемого уровня для этой creature line."},{reason:"LW",id:"below_seen_max_window",condition:"level < max(1, seenMax + minLevelOffset)",effect:"Не дает слишком старым уровням пробиваться за счет freshness."},{reason:"CN",id:"count_not_allowed_for_level",condition:"count > maxAllowedCount(level, seenMax)",effect:"Count ограничен по дистанции от seenMax: seenMax+1/seenMax <=x1, seenMax-1 <=x3, seenMax-2 <=x5, ниже <=x7."},{reason:"BL",id:"over_board_level",condition:"level > min(creature.maxLevel, boardCellCap)",effect:"На поле не хватает клеток под сборку target level после резерва генераторов и других открытых линий."},{reason:"RP",id:"repeat_previous_type_level",condition:"`${creatureType}:${level}` == lastLevelByCreature[creatureType]",effect:"Блокирует точный повтор последнего уровня именно для этой creature line."},{reason:"FM",id:"filler_same_creature_as_main",condition:"slot == 'filler' && creatureType == mainPick.creatureType",effect:"Filler не может брать ту же creature line, которую уже выбрал main slot."},{reason:"FS",id:"fp_sacrifices_required",condition:"timer row && fieldL1 == 0 && meatButtonPresses - meatPressesAtLastFP < fpAutoQuest.sacrificesRequired",effect:"Off-board FP строка ждет нужное число meat-button presses после последнего принятого FP квеста. Если существо уже на поле, D1 может его выесть без этого ожидания."},{reason:"FK",id:"fp_kraken_level_limit",condition:"timer row && fieldL1 == 0 && fpQuestsByKrakenLevel[kraken.level] >= fpAutoQuest.questsPerKrakenLevelLimit",effect:"Ограничивает количество off-board FP квестов на текущем Kraken level."},{reason:"FD",id:"fp_dual_limit",condition:"slot == 'filler' && main selected row is timer-mode",effect:"Dual auto quest может содержать максимум одно FP требование."}],a={preset:document.getElementById("snapshot-preset"),json:document.getElementById("json-input"),loadDemo:document.getElementById("load-demo"),analyze:document.getElementById("analyze"),mode:document.getElementById("mode"),budget:document.getElementById("budget"),mainSplit:document.getElementById("main-split"),fillerSplit:document.getElementById("filler-split"),fillerMainCreature:document.getElementById("filler-main-creature"),horizon:document.getElementById("horizon"),lineExposureTarget:document.getElementById("line-exposure-target"),secondaryLineExposureMultiplier:document.getElementById("secondary-line-exposure-multiplier"),levelWindowOffset:document.getElementById("level-window-offset"),sequenceTargetKl:document.getElementById("sequence-target-kl"),weights:document.getElementById("weights"),saveTestConfig:document.getElementById("save-test-config"),resetSettings:document.getElementById("reset-settings"),settingsStatus:document.getElementById("settings-status"),summary:document.getElementById("summary"),output:document.getElementById("output"),tabs:document.querySelectorAll(".debug-tab"),scoringPanel:document.getElementById("scoring-panel"),filtersPanel:document.getElementById("filters-panel"),filtersSummary:document.getElementById("filters-summary"),filtersOutput:document.getElementById("filters-output"),sequencePanel:document.getElementById("sequence-panel"),sequenceSummary:document.getElementById("sequence-summary"),sequenceOutput:document.getElementById("sequence-output")};function d(e,t=2){return Number.isFinite(e)?Number(e).toFixed(t):"inf"}function f(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function we(){a.weights.innerHTML=Object.entries(ue).map(([e,t])=>`
        <div class="field">
          <label for="w-${e}">${e}</label>
          <input id="w-${e}" class="cm-input" data-weight="${e}" type="number" step="0.1" value="${t}">
        </div>
      `).join("")}function Q(){const e={};for(const t of a.weights.querySelectorAll("[data-weight]"))e[t.dataset.weight]=Number(t.value);return e}function S(){const e=Number(a.levelWindowOffset.value);return Number.isFinite(e)?Math.min(0,Math.trunc(e)):B}function G(){return Math.max(0,-S())}function $(){const e=Number(a.lineExposureTarget.value);return Number.isFinite(e)?Math.max(0,Math.floor(e)):he}function N(){const e=Number(a.secondaryLineExposureMultiplier.value);return Number.isFinite(e)?Math.min(1,Math.max(0,e)):ve}function xe(e){var o,l;const t=((l=(o=e.tasks)==null?void 0:o.autoConfig)==null?void 0:l.fpAutoQuest)??{},n=Array.isArray(t.expectedTicksByDifficulty)?t.expectedTicksByDifficulty.map(r=>[Number(r==null?void 0:r[0]),Number(r==null?void 0:r[1])]).filter(([r,c])=>Number.isFinite(r)&&Number.isFinite(c)):[],s=Number(t.sacrificesRequired),i=Number(t.questsPerKrakenLevelLimit);return{sacrificesRequired:Number.isFinite(s)?Math.max(0,Math.floor(s)):q.sacrificesRequired,questsPerKrakenLevelLimit:Number.isFinite(i)?Math.max(0,Math.floor(i)):q.questsPerKrakenLevelLimit,expectedTicksByDifficulty:n.length?n:q.expectedTicksByDifficulty}}function Le(e,t){var s;let n=((s=q.expectedTicksByDifficulty[0])==null?void 0:s[1])??0;for(const[i,o]of e.expectedTicksByDifficulty)t>=i&&(n=o);return Math.max(0,n)}function qe(e,t){var i,o,l;if(!t)return!1;const n=(o=(i=e.generators)==null?void 0:i.generators)==null?void 0:o.find(r=>r.id===t.genId),s=(l=n==null?void 0:n.levels)==null?void 0:l.find(r=>r.level===t.genLevel);return(n==null?void 0:n.spawnMode)==="timer"||(s==null?void 0:s.mode)==="timer"}function $e(e,t){var n,s;return t?((s=(n=e.generators)==null?void 0:n.generators)==null?void 0:s.some(i=>{var o,l;return(o=i.lines)!=null&&o.includes(t)&&i.spawnMode==="timer"?!0:(l=i.levels)==null?void 0:l.some(r=>{var m;return(i.spawnMode==="timer"||r.mode==="timer")&&((m=r.outputs)==null?void 0:m.some(p=>p.creatureType===t))})}))??!1:!1}function J(){const e=S();return e===0?"seenMax":`seenMax - ${Math.abs(e)}`}function Ee(e){return e.id!=="below_seen_max_window"?e.condition:`level < max(1, ${J()})`}function Me(e){return e.id!=="below_seen_max_window"?e.effect:`${e.effect} Окно уровней: ${J()} ... seenMax+1.`}function X(){return{preset:a.preset.value,mode:a.mode.value,budget:a.budget.value,mainSplit:a.mainSplit.value,fillerSplit:a.fillerSplit.value,fillerMainCreature:a.fillerMainCreature.value,freshnessHorizon:Number(a.horizon.value)||12,lineExposureTarget:$(),secondaryLineExposureMultiplier:N(),levelWindowOffset:S(),levelWindowBelowSeenMax:G(),sequenceTargetKl:Number(a.sequenceTargetKl.value)||W,weights:Q()}}function V(){const e=X();return{savedAt:new Date().toISOString(),freshnessHorizon:e.freshnessHorizon,lineExposureTarget:e.lineExposureTarget,secondaryLineExposureMultiplier:e.secondaryLineExposureMultiplier,levelWindowBelowSeenMax:e.levelWindowBelowSeenMax,weights:e.weights}}function Y(){try{localStorage.setItem(A,JSON.stringify(X())),a.settingsStatus.textContent="Settings saved locally."}catch{a.settingsStatus.textContent="Could not save settings locally."}}function Te(){try{const e=localStorage.getItem(A);if(!e)return!1;const t=JSON.parse(e);if(t.preset&&(a.preset.value=t.preset),t.mode&&(a.mode.value=t.mode),t.budget!==void 0&&(a.budget.value=t.budget),t.mainSplit!==void 0&&(a.mainSplit.value=t.mainSplit),t.fillerSplit!==void 0&&(a.fillerSplit.value=t.fillerSplit),t.fillerMainCreature!==void 0&&(a.fillerMainCreature.value=t.fillerMainCreature),t.freshnessHorizon!==void 0&&(a.horizon.value=t.freshnessHorizon),t.lineExposureTarget!==void 0?a.lineExposureTarget.value=t.lineExposureTarget:t.budgetUseExposureThreshold!==void 0&&(a.lineExposureTarget.value=t.budgetUseExposureThreshold),t.secondaryLineExposureMultiplier!==void 0&&(a.secondaryLineExposureMultiplier.value=t.secondaryLineExposureMultiplier),t.levelWindowOffset!==void 0){const n=Number(t.levelWindowOffset);a.levelWindowOffset.value=Number.isFinite(n)?Math.min(0,Math.trunc(n)):B}else if(t.levelWindowBelowSeenMax!==void 0){const n=Number(t.levelWindowBelowSeenMax);a.levelWindowOffset.value=Number.isFinite(n)?-Math.max(0,Math.floor(n)):B}if(t.sequenceTargetKl!==void 0&&(a.sequenceTargetKl.value=t.sequenceTargetKl),t.weights&&typeof t.weights=="object")for(const n of a.weights.querySelectorAll("[data-weight]")){const s=t.weights[n.dataset.weight];s!==void 0&&(n.value=s)}return a.settingsStatus.textContent="Restored saved settings.",!0}catch{return a.settingsStatus.textContent="Could not restore saved settings.",!1}}async function Ce(){const e=V();try{localStorage.setItem("cult-merge-autoquest-scoring-test-config-v1",JSON.stringify(e)),localStorage.setItem("cult-merge-autoquest-scoring-v2-enabled","1"),a.settingsStatus.textContent="Applied to browser simulation test. Simulation will use scoring v2."}catch(t){a.settingsStatus.textContent=`Apply failed: ${t instanceof Error?t.message:String(t)}`}}function ke(){const e=de(v,{seed:12345});e.kraken.level=8,e.resources.eyes=3200,e.resources.meat=100,e.resources.rune1=50,e.resources.rune2=30;const t=fe(v,e.kraken.level);e.grid={rows:t.rows,cols:t.cols,cells:Array.from({length:t.rows*t.cols},()=>null)};const n=Object.values(e.entities).find(s=>s.kind==="generator"&&s.generatorId===1);return n&&(e.grid.cells[0]=n.id),e.spawnCountByGen={1:100,2:80},e.autoTaskLineCompletions={Creature1:1,Creature2:1},e.autoTaskLastLevels={Creature1:4,Creature2:2,Creature3:3},e}function _e(e,t,n,s,i){e.entities[t]={id:t,kind:"generator",generatorId:n,level:s,charges:[]},e.grid.cells[i]=t}function Be(e,t,n,s,i){e.entities[t]={id:t,kind:"creature",creatureType:n,level:s},e.grid.cells[i]=t}function E(e){const t=ke(),n=Object.values(t.entities).find(s=>s.kind==="generator"&&s.generatorId===1);return(e==="gen1-l4"||e==="two-generators")&&(n&&(n.level=4),t.spawnCountByGen={1:100},t.spawnsSpentByGen={}),e==="two-generators"&&(_e(t,"debug_gen_2_l1",2,1,1),Be(t,"debug_creature_1_l1","Creature1",1,2),t.spawnCountByGen={1:100,2:20}),t}function M(e,t){const n=I(e,t);a.budget.value=d(n.meatBudget,1)}function Z(){var l,r,c,m;const e=a.json.value.trim();if(!e){const p=E(a.preset.value);return{balance:v,state:p,history:[]}}const t=JSON.parse(e),n=Array.isArray(t)?t[0]:t,s=((l=n==null?void 0:n.config)==null?void 0:l.balance)??((r=t==null?void 0:t.config)==null?void 0:r.balance)??v,i=(n==null?void 0:n.finalState)??(t==null?void 0:t.finalState)??(n==null?void 0:n.gameState)??(t==null?void 0:t.gameState)??((m=(c=n==null?void 0:n.history)==null?void 0:c[n.history.length-1])==null?void 0:m.gameState)??t,o=(n==null?void 0:n.autoTaskHistory)??(t==null?void 0:t.autoTaskHistory)??(i==null?void 0:i.recentAutoQuestHistory)??[];if(!(i!=null&&i.entities)||!(i!=null&&i.grid)||!(i!=null&&i.kraken))throw new Error("JSON must be a SimulationResult export or a GameSnapshot-like object.");return{balance:s,state:i,history:o}}function u(e,t){return`
        <div class="metric">
          <div class="metric-label">${f(e)}</div>
          <div class="metric-value">${f(t)}</div>
        </div>
      `}function Ie(e){const t=e.selected;if(!t)return'<div class="empty">No allowed row</div>';const n=e.allowedRows.find(i=>i!==t),s=n?t.score-n.score:null;return`
        <div class="selected">
          <span class="pill"><strong>${t.creatureType} L${t.level} x${t.count}</strong></span>
          <span class="pill">Gen${t.genId} L${t.genLevel}</span>
          <span class="pill">allowed ${ee(t)}</span>
          <span class="pill">score ${d(t.score,3)}</span>
          ${s===null?"":`<span class="pill">margin ${d(s,3)}</span>`}
          <span class="pill">cost ${d(t.estimatedMeatCost,2)}</span>
          <span class="pill">required L1 ${d(t.requiredL1,0)}</span>
          <span class="pill">completions ${t.lineCompletions??0}</span>
        </div>
      `}function Ae(e){const t=e.selected;return t?`
        <div class="breakdown">
          ${Se.map(([n,s])=>`
            <div class="breakdown-item" data-tip="${f(Fe(t,n,s,e.weights))}">
              <div class="breakdown-label">${f(s)}</div>
              <div class="breakdown-value">${d(t.weightedContributions[n],3)}</div>
            </div>
          `).join("")}
        </div>
      `:""}function Ne(e,t){switch(t){case"lineNovelty":return e.lineNoveltyScore;case"lineFreshness":return e.lineFreshnessScore;case"questFreshness":return e.questFreshnessScore;case"lineExposure":return e.lineExposureScore;case"budgetUse":return e.budgetUseScore;case"fieldSupport":return e.fieldSupportScore;case"level":return e.levelScore;default:return 0}}function Fe(e,t,n,s){const i=`${n}: ${d(e.weightedContributions[t],3)} pts = weight ${d(s[t],2)} × component ${d(Ne(e,t),2)}`;return t!=="lineExposure"?i:[i,`line completions: ${e.lineCompletions??0}/${$()}`,`role multiplier: ${d(e.lineExposureRoleMultiplier??1,2)}`].join(`
`)}function ee(e){return`<=x${e.maxAllowedCount}`}function Oe(e){return`${String(e.creatureType).replace(/^Creature/i,"")}-${e.level} x${e.count}`}function Re(e){const t=new Map;for(const s of e.rows)for(const i of s.forbiddenReasons)t.set(i,(t.get(i)??0)+1);return t.size===0?"":`<div class="reason-summary">${[...t.entries()].sort((s,i)=>i[1]-s[1]).map(([s,i])=>{const o=F(s);return`<span class="pill" data-tip="${f(`${s}: ${o.explanation}`)}">${f(o.label)} <strong>${i}</strong></span>`}).join("")}</div>`}function F(e){return j[e]??{label:e,explanation:e}}function Ke(e){return e.forbiddenReasons.length===0?"OK":e.forbiddenReasons.map(t=>F(t).code??t).join(" ")}function De(e){return e.forbiddenReasons.length===0?"This row passed every hard filter and is eligible for top-1 selection.":e.forbiddenReasons.map(t=>{const n=F(t);return`${n.label}: ${n.explanation}`}).join(`
`)}function He(e){const t=e.rows.slice(0,320);return t.length===0?'<div class="empty">No scoring rows</div>':`
        <div class="table-wrap">
          <table>
            <colgroup>
              <col class="c-state">
              <col class="c-score">
              <col class="c-quest">
              <col class="c-gen">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-cells">
              <col class="c-l1">
              <col class="c-l1">
              <col class="c-l1">
              <col class="c-l1">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
              <col class="c-comp">
            </colgroup>
            <thead>
              <tr>
                <th class="left" data-tip="Whether the row is available. If filtered out, this shows the hard filter reasons that removed it from selection.">state</th>
                <th data-tip="Final weighted score. Allowed rows are sorted by this value, and the top row is selected.">score</th>
                <th class="left" data-tip="Quest requirement candidate: creature line, requested level, and odd count.">quest</th>
                <th data-tip="Generator and scoring level used to estimate production for this row. Scoring level can be fact level +1 when an upgrade is currently available.">gen</th>
                <th data-tip="Highest level of this creature line the player has ever seen or currently has on the board. Rows above seenMax + 1 are filtered out.">seen<br>max</th>
                <th data-tip="Relative distance from seen max: -1 means seenMax + 1, 0 means seenMax, 1 means seenMax - 1, and so on.">max<br>dist</th>
                <th data-tip="Maximum count allowed for this level. Lower odd counts are allowed; higher counts are filtered out. seenMax + 1 and seenMax allow only x1; seenMax - 1 allows up to x3.">allowed</th>
                <th data-tip="Board cells available for this creature line after cells occupied by generators and one reserved cell for each other opened creature line.">cells</th>
                <th data-tip="Total L1-equivalent required by this quest row: count multiplied by 2^(level - 1).">reqL1</th>
                <th data-tip="Current board inventory for this creature line converted to L1-equivalent. Used for reachability and field support.">field<br>L1</th>
                <th data-tip="Expected L1-equivalent produced by this generator inside the current budget/window.">spawn<br>L1</th>
                <th data-tip="Total L1-equivalent capacity for this creature line: field L1 plus spawn L1.">cap<br>L1</th>
                <th data-tip="Line novelty component, normalized 0..1 by creature unlock order within currently opened on-field generator lines. Later-unlocked opened lines score higher.">novel</th>
                <th data-tip="How many auto quests ago this creature line appeared. Never-seen lines get the freshness horizon value.">line<br>ago</th>
                <th data-tip="How many auto quests ago this exact creature line + level appeared. Used separately from line freshness.">quest<br>ago</th>
                <th data-tip="Completed quest count for this creature line. Low-completion lines receive line exposure score.">done</th>
                <th data-tip="Line exposure score: (target - completions) / target, multiplied by the line-role multiplier.">expose</th>
                <th data-tip="Line-role multiplier used by exposure. Primary lines use 1.0; secondary lines use the configured secondary multiplier.">role</th>
                <th data-tip="Budget-use score: requiredL1 / totalL1Capacity, clamped to 0..1. This is no longer adjusted by line exposure.">budget</th>
                <th data-tip="Field-support score, normalized 0..1. Rows already supported by board inventory score higher.">field</th>
                <th data-tip="Level score normalized against the player-opened cap: seenMax + 1. The currently newest allowed level gets the strongest boost.">lvl</th>
              </tr>
            </thead>
            <tbody>
              ${t.map(n=>`
                <tr class="${n.forbiddenReasons.length?"is-filtered":""}">
                  <td class="${n.forbiddenReasons.length?"reason":"ok"}" data-tip="${f(De(n))}">${f(Ke(n))}</td>
                  <td>${d(n.score,3)}</td>
                  <td class="left">${f(Oe(n))}</td>
                  <td>G${n.genId} L${n.genLevel}</td>
                  <td>${n.seenMaxLevel}</td>
                  <td>${n.levelDistanceFromSeenMax}</td>
                  <td>${ee(n)}</td>
                  <td>${n.boardCellCap}</td>
                  <td>${d(n.requiredL1,0)}</td>
                  <td>${d(n.fieldL1,1)}</td>
                  <td>${d(n.spawnL1Capacity,1)}</td>
                  <td>${d(n.totalL1Capacity,1)}</td>
                  <td>${d(n.lineNoveltyScore,2)}</td>
                  <td>${n.lineLastSeenAgo}</td>
                  <td>${n.questLastSeenAgo}</td>
                  <td>${n.lineCompletions??0}</td>
                  <td>${d(n.lineExposureScore??0,2)}</td>
                  <td>${d(n.lineExposureRoleMultiplier??1,2)}</td>
                  <td>${d(n.budgetUseScore,2)}</td>
                  <td>${d(n.fieldSupportScore,2)}</td>
                  <td>${d(n.levelScore,2)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `}function Pe(e,t){return`
        <article class="cm-card section">
          <div class="section-head">
            <div class="section-title">${f(e)}</div>
            <div class="section-sub">${t.allowedRows.length}/${t.rows.length} allowed</div>
          </div>
          ${Ie(t)}
          ${Ae(t)}
          ${Re(t)}
          ${He(t)}
        </article>
      `}function Ue(e){const t=new Map;let n=0,s=0;for(const[,i]of e){n+=i.rows.length,s+=i.allowedRows.length;for(const o of i.rows)for(const l of o.forbiddenReasons)t.set(l,(t.get(l)??0)+1)}return{counts:t,totalRows:n,allowedRows:s,filteredRows:Math.max(0,n-s)}}function te(e,t,n){var K;a.budget.value||M(e,t);const s=Number(a.budget.value)||0,i=I(e,t),o=Number(a.mainSplit.value)||.7,l=Number(a.fillerSplit.value)||.3,r=a.mode.value,c=Number(a.horizon.value)||12,m=G(),p=$(),b=N(),y=Q(),T=xe(e),O=Le(T,i.difficulty),R={sacrificesRequired:T.sacrificesRequired,questsPerKrakenLevelLimit:T.questsPerKrakenLevelLimit},C=[];let h=null;if((r==="main"||r==="dual")&&(h=H(e,t,{slot:"main",meatBudget:r==="dual"?s*o:s,history:n,freshnessHorizon:c,levelWindowBelowSeenMax:m,lineExposureTarget:p,secondaryLineExposureMultiplier:b,weights:y,fpExpectedTicks:O,fpGate:R}),C.push(["Main",h])),r==="filler"||r==="dual"){const k=a.fillerMainCreature.value.trim(),D=k||((K=h==null?void 0:h.selected)==null?void 0:K.creatureType),re=k?$e(e,k):qe(e,h==null?void 0:h.selected),ce=H(e,t,{slot:"filler",meatBudget:r==="dual"?s*l:s,history:n,freshnessHorizon:c,levelWindowBelowSeenMax:m,lineExposureTarget:p,secondaryLineExposureMultiplier:b,weights:y,mainPick:D?{creatureType:D}:null,fpExpectedTicks:O,fpGate:R,disallowTimerGenerators:re});C.push(["Filler",ce])}return C}function je(){try{const{balance:e,state:t,history:n}=Z(),s=te(e,t,n),i=Ue(s),o=[...i.counts.values()].filter(l=>l>0).length;a.filtersSummary.innerHTML=[u("Filters",P.length),u("Active now",o),u("Min level offset",S()),u("Rows",i.totalRows),u("Allowed rows",i.allowedRows),u("Filtered rows",i.filteredRows)].join(""),a.filtersOutput.innerHTML=`
          <article class="cm-card section">
            <div class="section-head">
              <div class="section-title">Hard Filters</div>
              <div class="section-sub">Removed before score ranking</div>
            </div>
            <div class="table-wrap">
              <table class="filter-doc-table">
                <colgroup>
                  <col class="c-code">
                  <col class="c-count">
                  <col class="c-filter">
                  <col class="c-condition">
                  <col>
                </colgroup>
                <thead>
                  <tr>
                    <th class="left">code</th>
                    <th>hits</th>
                    <th class="left">filter</th>
                    <th class="left">condition</th>
                    <th class="left">how it works</th>
                  </tr>
                </thead>
                <tbody>
                  ${P.map(l=>{const r=j[l.id],c=i.counts.get(l.id)??0;return`
                      <tr>
                        <td class="left"><strong>${f((r==null?void 0:r.code)??l.reason)}</strong></td>
                        <td>${c}</td>
                        <td class="left">${f((r==null?void 0:r.label)??l.id)}</td>
                        <td class="left condition">${f(Ee(l))}</td>
                        <td class="left">${f(Me(l))}</td>
                      </tr>
                    `}).join("")}
                </tbody>
              </table>
            </div>
          </article>
        `}catch(e){a.filtersOutput.innerHTML=`<div class="empty">${f(e instanceof Error?e.message:String(e))}</div>`}}let _=null;function We(){return _||(_=fetch(be).then(e=>{if(!e.ok)throw new Error(`Could not load baseline artifact: ${e.status}`);return e.json()})),_}function ne(){const e=Number(a.sequenceTargetKl.value),t=50;return Number.isFinite(e)?Math.max(2,Math.min(t,Math.floor(e))):W}function ze(e,t){return e.filter(n=>n.krakenLevel<=t)}function Qe(e){const t=new Map(e.autoTaskHistory.map(i=>[i.taskId,i])),n=[];let s=0;return e.actionLog.forEach((i,o)=>{var p,b;if(i.action.type!=="quest_completed")return;const l=((b=(p=e.actionHistory[o])==null?void 0:p.metrics)==null?void 0:b.totalSpawns)??s,r=Math.max(0,l-s);s=l;const c=t.get(i.action.taskLabel),m=(c==null?void 0:c.creatures)??i.action.creatures.map(y=>({type:y.type,level:y.level,count:y.count,genId:null,genLevel:null}));n.push({sequence:n.length+1,kind:c?"auto":"mandatory",taskId:i.action.taskLabel,krakenLevel:i.state.krakenLevel,spawns:r,difficulty:c==null?void 0:c.difficulty,debugMeatBudget:c==null?void 0:c.debugMeatBudget,debugMeatCost:c==null?void 0:c.debugMeatCost,gen:Je({creatures:m}),quest:Ge({creatures:m})})}),n}function Ge(e){return e.creatures.map(t=>`${t.type} L${t.level}${t.count>1?` x${t.count}`:""}`).join(" + ")}function Je(e){return[...new Set(e.creatures.map(n=>n.genId===null?"?":`G${n.genId}`))].join("+")}function x(e){return e?e.kind==="mandatory"?"M":"A":""}function L(e,t){return e.filter(n=>n.kind===t).length}function Xe(){const e=ne(),t=localStorage.getItem("cult-merge-autoquest-scoring-v2-enabled"),n=localStorage.getItem("cult-merge-autoquest-scoring-test-config-v1"),s=V();localStorage.setItem("cult-merge-autoquest-scoring-v2-enabled","1"),localStorage.setItem("cult-merge-autoquest-scoring-test-config-v1",JSON.stringify(s));try{return new pe({seed:z,stopCondition:{type:"krakenLevel",value:e},maxTicks:ye,tickInterval:1e3,strategy:new ge,balance:v}).run()}finally{t===null?localStorage.removeItem("cult-merge-autoquest-scoring-v2-enabled"):localStorage.setItem("cult-merge-autoquest-scoring-v2-enabled",t),n===null?localStorage.removeItem("cult-merge-autoquest-scoring-test-config-v1"):localStorage.setItem("cult-merge-autoquest-scoring-test-config-v1",n)}}function Ve(e,t){const n=Math.max(e.length,t.length);return`
        <div class="table-wrap sequence-table">
          <table>
            <colgroup>
              <col class="c-num">
              <col class="c-small">
              <col class="c-kind">
              <col class="c-small">
              <col class="c-small">
              <col class="c-quest-wide">
              <col class="c-small">
              <col class="c-kind">
              <col class="c-small">
              <col class="c-small">
              <col class="c-quest-wide">
            </colgroup>
            <thead>
              <tr>
                <th rowspan="2" data-tip="Completed quest index in this comparison run.">#</th>
                <th class="sequence-group group-base" colspan="5" data-tip="Static baseline sequence from the stored KL50 artifact, filtered to the selected target KL.">Base</th>
                <th class="sequence-group group-experiment" colspan="5" data-tip="Experiment sequence recalculated with the current weights, freshness horizon, and budget exposure settings on this page.">Experiment</th>
              </tr>
              <tr>
                <th data-tip="Kraken level when this quest completed.">KL</th>
                <th data-tip="Quest kind. M = mandatory, A = auto.">kind</th>
                <th data-tip="Auto quest difficulty. Empty for mandatory quests.">diff</th>
                <th data-tip="Generator spawns between the previous completed quest and this one.">spawns</th>
                <th class="left" data-tip="Static baseline quest from the stored KL50 artifact.">quest</th>
                <th class="split-left" data-tip="Kraken level when this quest completed.">KL</th>
                <th data-tip="Quest kind. M = mandatory, A = auto.">kind</th>
                <th data-tip="Auto quest difficulty. Empty for mandatory quests.">diff</th>
                <th data-tip="Generator spawns between the previous completed quest and this one.">spawns</th>
                <th class="left" data-tip="Experiment quest recalculated with the current scoring controls on this page.">quest</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from({length:n},(s,i)=>{const o=e[i],l=t[i];return`
                  <tr class="${((o==null?void 0:o.quest)??"")!==((l==null?void 0:l.quest)??"")||((o==null?void 0:o.kind)??"")!==((l==null?void 0:l.kind)??"")?"is-different":""}">
                    <td class="muted-col">${i+1}</td>
                    <td class="muted-col">${(o==null?void 0:o.krakenLevel)??""}</td>
                    <td class="kind-${x(o).toLowerCase()}">${x(o)}</td>
                    <td>${(o==null?void 0:o.difficulty)??""}</td>
                    <td>${(o==null?void 0:o.spawns)??""}</td>
                    <td class="left quest-text">${f((o==null?void 0:o.quest)??"")}</td>
                    <td class="split-left muted-col">${(l==null?void 0:l.krakenLevel)??""}</td>
                    <td class="kind-${x(l).toLowerCase()}">${x(l)}</td>
                    <td>${(l==null?void 0:l.difficulty)??""}</td>
                    <td>${(l==null?void 0:l.spawns)??""}</td>
                    <td class="left quest-text">${f((l==null?void 0:l.quest)??"")}</td>
                  </tr>
                `}).join("")}
            </tbody>
          </table>
        </div>
      `}async function se(){var t;const e=ne();a.sequenceTargetKl.value=String(e),a.sequenceOutput.innerHTML='<div class="empty">Running V2 simulation with current scoring controls...</div>',a.sequenceSummary.innerHTML="",await new Promise(n=>requestAnimationFrame(n));try{const n=await We(),s=ze(n.sequence??[],e),i=Xe(),o=Qe(i),l=L(s,"auto"),r=L(o,"auto");a.sequenceSummary.innerHTML=[u("Seed",z),u("Target KL",e),u("Base tasks",s.length),u("Experiment tasks",o.length),u("Base A/M",`${l}/${L(s,"mandatory")}`),u("Experiment A/M",`${r}/${L(o,"mandatory")}`),u("Min level offset",S()),u("Experiment meat",i.summary.totalMeatSpent),u("Experiment time",i.summary.totalTimeFormatted)].join(""),a.sequenceOutput.innerHTML=`
          <article class="cm-card section">
            <div class="sequence-toolbar">
              <div>
                <div class="section-title">Side By Side Sequence</div>
                <div class="sequence-note">Base is static baseline KL50 artifact, filtered to target KL. Experiment recalculates from current scoring controls.</div>
              </div>
              <button class="cm-btn cm-btn--ghost" type="button" id="rerun-sequence">Rerun</button>
            </div>
            ${Ve(s,o)}
          </article>
        `,(t=document.getElementById("rerun-sequence"))==null||t.addEventListener("click",se)}catch(n){a.sequenceOutput.innerHTML=`<div class="empty">${f(n instanceof Error?n.message:String(n))}</div>`}}function U(){var e;return((e=[...a.tabs].find(t=>t.getAttribute("aria-selected")==="true"))==null?void 0:e.dataset.tab)??"scoring"}function w(){U()==="sequence"?se():U()==="filters"?je():Ze()}function Ye(e){for(const t of a.tabs)t.setAttribute("aria-selected",t.dataset.tab===e?"true":"false");a.scoringPanel.classList.toggle("hidden",e!=="scoring"),a.filtersPanel.classList.toggle("hidden",e!=="filters"),a.sequencePanel.classList.toggle("hidden",e!=="sequence"),w()}function Ze(){var e,t,n,s,i;try{const{balance:o,state:l,history:r}=Z(),c=te(o,l,r),m=I(o,l);a.summary.innerHTML=[u("KL",l.kraken.level),u("Chapter",((e=c[0])==null?void 0:e[1].context.chapter)??"-"),u("Default budget",d(m.meatBudget,1)),u("Board cells",`${((t=c[0])==null?void 0:t[1].context.gridCap)??"-"} / ${((n=c[0])==null?void 0:n[1].context.gridCells)??"-"}`),u("Generator cells",((s=c[0])==null?void 0:s[1].context.generatorCellCount)??"-"),u("Opened lines",((i=c[0])==null?void 0:i[1].context.openedCreatureLineCount)??"-"),u("Min level offset",S()),u("History rows",r.length),u("Line exposure",`${$()} / ${d(N(),2)}`)].join(""),a.output.innerHTML=c.map(([p,b])=>Pe(p,b)).join("")}catch(o){a.output.innerHTML=`<div class="empty">${f(o instanceof Error?o.message:String(o))}</div>`}}we();const g=document.createElement("div");g.className="debug-tooltip";document.body.appendChild(g);function ie(e){const n=window.innerWidth-g.offsetWidth-14,s=window.innerHeight-g.offsetHeight-14;g.style.left=`${Math.max(14,Math.min(n,e.clientX+14))}px`,g.style.top=`${Math.max(14,Math.min(s,e.clientY+14))}px`}document.addEventListener("pointerover",e=>{var n,s;const t=(s=(n=e.target).closest)==null?void 0:s.call(n,"[data-tip]");t&&(g.textContent=t.dataset.tip,g.style.display="block",ie(e))});document.addEventListener("pointermove",e=>{var n,s;if(g.style.display!=="block")return;if(!((s=(n=e.target).closest)==null?void 0:s.call(n,"[data-tip]"))){g.style.display="none";return}ie(e)});document.addEventListener("pointerout",e=>{var t,n;(n=(t=e.target).closest)!=null&&n.call(t,"[data-tip]")&&(g.style.display="none")});const ae=E(a.preset.value);a.json.value=JSON.stringify(ae,null,2);M(v,ae);Te();const oe=E(a.preset.value);a.json.value=JSON.stringify(oe,null,2);a.budget.value||M(v,oe);function le(){const e=E(a.preset.value);a.json.value=JSON.stringify(e,null,2),M(v,e),Y(),w()}a.loadDemo.addEventListener("click",le);a.preset.addEventListener("change",le);a.analyze.addEventListener("click",w);a.saveTestConfig.addEventListener("click",Ce);for(const e of a.tabs)e.addEventListener("click",()=>Ye(e.dataset.tab));a.resetSettings.addEventListener("click",()=>{localStorage.removeItem(A),localStorage.removeItem("cult-merge-autoquest-scoring-test-config-v1"),localStorage.removeItem("cult-merge-autoquest-scoring-v2-enabled"),a.settingsStatus.textContent="Saved settings reset."});for(const e of document.querySelectorAll("input, select"))e.addEventListener("change",()=>{Y(),w()});w();
