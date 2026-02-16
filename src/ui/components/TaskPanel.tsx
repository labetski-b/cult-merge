import { useGameStore, useCurrentTask, useCurrentTaskFed } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getTaskFedProgress } from '@domain/tasks';
import { getCreatureReward, applyTaskMultiplier } from '@domain/rewards';
import { getCreatureImage } from '@ui/creatureImages';

export function TaskPanel() {
  const krakenLevel = useGameStore((s) => s.kraken.level);
  const task = useCurrentTask();
  const fed = useCurrentTaskFed();

  // Tasks unlock at level 2
  if (krakenLevel < 2) {
    return (
      <section className="panel task-panel">
        <h2>Task</h2>
        <p className="task-locked">Required: Kraken Lv.2</p>
      </section>
    );
  }

  const progress = task ? getTaskFedProgress(task.creatures, fed) : [];

  let totalEyes = 0;
  if (task) {
    for (const req of task.creatures) {
      const reward = getCreatureReward(BALANCE, req.type, req.level);
      totalEyes += reward.eyes * req.count;
    }
    totalEyes = Math.floor(applyTaskMultiplier(totalEyes, task.resMultiplier));
  }

  return (
    <section className="panel task-panel">
      <h2>Task</h2>
      {task ? (
        <>
          <div className="task-requirements">
            {progress.map(({ requirement, fed: count }) => {
              const done = count >= requirement.count;
              const img = getCreatureImage(requirement.type, requirement.level);
              return (
                <div
                  key={`${task.id}-${requirement.type}-${requirement.level}`}
                  className={`task-req${done ? ' task-req-done' : ''}`}
                >
                  {img ? (
                    <img src={img} alt={requirement.type} className="task-req-img" />
                  ) : (
                    <span className="task-req-label">{requirement.type}</span>
                  )}
                  <span className="task-req-count">
                    L{requirement.level} {count}/{requirement.count}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="task-reward">+{totalEyes} Eyes</div>
        </>
      ) : (
        <p className="task-empty">No task</p>
      )}
    </section>
  );
}
