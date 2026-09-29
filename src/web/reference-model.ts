import { normalizeSegments, serialize, type Segment } from '../shared/references.js';
export interface EditState { segments: Segment[]; start: number; end: number }
export class ReferenceHistory {
  state: EditState = { segments: [], start: 0, end: 0 };
  private undoStack: EditState[] = [];
  private redoStack: EditState[] = [];
  revision = 0;
  select(start: number, end = start) { this.state = { ...this.state, start, end }; }
  commit(next: EditState) {
    if (serialize(next.segments).length > 32000) throw Error('任务内容不能超过 32000 个字符（包含完整引用路径）');
    const changed = JSON.stringify(this.state.segments) !== JSON.stringify(next.segments);
    if (changed) { this.undoStack.push(structuredClone(this.state)); this.undoStack = this.undoStack.slice(-100); this.redoStack = []; this.revision++; }
    this.state = { ...next, segments: normalizeSegments(next.segments) };
  }
  move(redo: boolean) {
    const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
    const next = from.pop(); if (!next) return;
    to.push(structuredClone(this.state)); this.state = next; this.revision++;
  }
  reset(segments: Segment[] = []) { this.state = { segments, start: serialize(segments).length, end: serialize(segments).length }; this.undoStack = []; this.redoStack = []; this.revision++; }
}
