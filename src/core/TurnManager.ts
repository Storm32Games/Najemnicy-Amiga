// Maszyna stanów tur: gracz <-> wróg.
// Niezależna od Phasera - WorldScene steruje przejściami, a zmiany faz
// rozgłasza dalej (np. do game.registry dla HUD-u).

export const TurnPhase = {
  /** Poza walką: drużyna chodzi swobodnie (ruch = jedna akcja eksploracji). */
  EXPLORATION: 'EXPLORATION',
  PLAYER_TURN: 'PLAYER_TURN',
  ENEMY_TURN: 'ENEMY_TURN',
} as const;
export type TurnPhase = (typeof TurnPhase)[keyof typeof TurnPhase];

export type TurnPhaseListener = (phase: TurnPhase, turn: number) => void;

export class TurnManager {
  private _phase: TurnPhase = TurnPhase.PLAYER_TURN;
  private _turn = 1;
  private listeners = new Set<TurnPhaseListener>();

  public get phase(): TurnPhase {
    return this._phase;
  }

  /** Numer bieżącej rundy (rośnie, gdy tura wraca do gracza). */
  public get turn(): number {
    return this._turn;
  }

  public isPlayerTurn(): boolean {
    return this._phase === TurnPhase.PLAYER_TURN;
  }

  public isEnemyTurn(): boolean {
    return this._phase === TurnPhase.ENEMY_TURN;
  }

  /** Rejestruje słuchacza zmian fazy. Zwraca funkcję wyrejestrowującą. */
  public onChange(listener: TurnPhaseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** PLAYER_TURN -> ENEMY_TURN. Zwraca false, jeśli to nie była tura gracza. */
  public endPlayerTurn(): boolean {
    if (this._phase !== TurnPhase.PLAYER_TURN) return false;
    this.setPhase(TurnPhase.ENEMY_TURN);
    return true;
  }

  /** ENEMY_TURN -> PLAYER_TURN (nowa runda). Zwraca false, jeśli to nie była tura wroga. */
  public endEnemyTurn(): boolean {
    if (this._phase !== TurnPhase.ENEMY_TURN) return false;
    this._turn++;
    this.setPhase(TurnPhase.PLAYER_TURN);
    return true;
  }

  private setPhase(phase: TurnPhase): void {
    this._phase = phase;
    for (const listener of this.listeners) listener(phase, this._turn);
  }
}
