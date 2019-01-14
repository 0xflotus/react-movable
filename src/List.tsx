import * as React from 'react';
import {
  getTranslateOffset,
  transformItem,
  setItemTransition,
  binarySearch,
  arrayRemove
} from './utils';

export interface IVoiceover {
  item: (position: number) => string;
  lifted: (position: number) => string;
  dropped: (from: number, to: number) => string;
  moved: (position: number, up: boolean) => string;
  canceled: (position: number) => string;
}

export interface IBaseItemProps {
  index: number;
  isDragged: boolean;
  isSelected: boolean;
  isActive: boolean;
  ghostItemStyle: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  onMouseStart: (
    e: React.MouseEvent,
    index: number,
    target?: HTMLElement
  ) => void;
  onTouchStart: (
    e: React.TouchEvent,
    index: number,
    target?: HTMLElement
  ) => void;
  onKeyDown: (e: React.KeyboardEvent, index: number) => void;
  setItemRef: (ref: React.RefObject<HTMLElement>, index: number) => void;
  removeItemRef: (index: number) => void;
  setGhostRef: (ref: React.RefObject<HTMLElement>) => void;
  voiceover: IVoiceover;
}

interface IListProps<Value> {
  render: (
    props: {
      items: { value: Value; itemProps: IBaseItemProps }[];
      isDragged: boolean;
      scrollProps: {
        onWheel: (e: React.WheelEvent) => void;
        ref: React.RefObject<any>;
      };
    }
  ) => React.ReactNode;
  values: Value[];
  onChange: (meta: { oldIndex: number; newIndex: number }) => void;
  transitionDuration: number;
  lockVertically: boolean;
  voiceover: IVoiceover;
}

class List<Value = string> extends React.Component<IListProps<Value>> {
  items: React.RefObject<HTMLElement>[] = [];
  listRef = React.createRef<HTMLElement>();
  ghostRef = React.createRef<HTMLElement>();
  topOffsets: number[] = [];
  itemTranslateOffsets: number[] = [];
  initialYOffset = 0;
  lastScroll = 0;
  needle = -1;
  afterIndex = -2;
  state = {
    itemDragged: -1,
    selectedItem: -1,
    initialX: 0,
    initialY: 0,
    targetX: 0,
    targetY: 0,
    targetHeight: 0,
    targetWidth: 0,
    liveText: ''
  };

  static defaultProps = {
    transitionDuration: 300,
    lockVertically: false,
    voiceover: {
      item: (position: number) =>
        `You are currently at a draggable item at position ${position}. Press space bar to lift.`,
      lifted: (position: number) =>
        `You have lifted item at position ${position}. Press j to move down, k to move up, space bar to drop and escape to cancel.`,
      moved: (position: number, up: boolean) =>
        `You have moved the lifted item ${
          up ? 'up' : 'down'
        } to position ${position}. Press j to move down, k to move up, space bar to drop and escape to cancel.`,
      dropped: (from: number, to: number) =>
        `You have dropped the item. It has moved from position ${from} to ${to}.`,
      canceled: (position: number) =>
        `You have cancelled the movement. The item has returned to its starting position of ${position}.`
    }
  };

  calculateOffsets = () => {
    if (!this.items[0].current) return;
    this.topOffsets = this.items.map((item, index) => {
      if (!item.current) {
        return 0;
      }
      return item.current!.getBoundingClientRect().top;
    });
    this.itemTranslateOffsets = this.items.map(item =>
      getTranslateOffset(item)
    );
  };

  onMouseStart = (e: React.MouseEvent, index: number, target?: HTMLElement) => {
    if (e.button !== 0) return;
    document.addEventListener('mousemove', this.onMouseMove, { passive: true });
    document.addEventListener('mouseup', this.onEnd, { passive: true });
    this.onStart(
      target ? target : (e.target as HTMLElement),
      e.clientX,
      e.clientY,
      index
    );
  };

  onTouchStart = (e: React.TouchEvent, index: number, target?: HTMLElement) => {
    document.addEventListener('touchmove', this.onTouchMove, { passive: true });
    document.addEventListener('touchend', this.onEnd, { passive: true });
    document.addEventListener('touchcancel', this.onEnd, { passive: true });
    this.onStart(
      target ? target : (e.target as HTMLElement),
      e.touches[0].clientX,
      e.touches[0].clientY,
      index
    );
  };

  getYOffset = () => {
    const listScroll = this.listRef.current
      ? this.listRef.current.scrollTop
      : 0;
    return window.pageYOffset + listScroll;
  };
  onStart = (
    target: HTMLElement,
    clientX: number,
    clientY: number,
    index: number
  ) => {
    if (this.state.selectedItem > -1) {
      this.setState({ selectedItem: -1 });
      this.needle = -1;
    }
    const targetRect = target.getBoundingClientRect() as DOMRect;
    const targetStyles = window.getComputedStyle(target);
    this.calculateOffsets();
    this.initialYOffset = this.getYOffset();
    this.setState({
      itemDragged: index,
      targetX: targetRect.x - parseInt(targetStyles['margin-left' as any], 10),
      targetY: targetRect.y - parseInt(targetStyles['margin-top' as any], 10),
      targetHeight: targetRect.height,
      targetWidth: targetRect.width,
      initialX: clientX,
      initialY: clientY
    });
  };

  onMouseMove = (e: MouseEvent) => this.onMove(e.clientX, e.clientY);

  onTouchMove = (e: TouchEvent) =>
    this.onMove(e.touches[0].clientX, e.touches[0].clientY);

  onWheel = (e: React.WheelEvent) => {
    if (this.state.itemDragged < 0) return;
    this.lastScroll = this.listRef.current!.scrollTop += e.deltaY;
    this.moveOtherItems();
  };

  onMove = (clientX: number, clientY: number) => {
    if (this.state.itemDragged === -1) return null;
    transformItem(
      this.ghostRef,
      clientY - this.state.initialY,
      this.props.lockVertically ? 0 : clientX - this.state.initialX
    );
    this.moveOtherItems();
  };

  moveOtherItems = () => {
    const targetRect = this.ghostRef.current!.getBoundingClientRect();
    const itemVerticalCenter = targetRect.top + targetRect.height / 2;
    const offset = getTranslateOffset(this.items[this.state.itemDragged]);
    const currentYOffset = this.getYOffset();
    // adjust offsets if scrolling happens during the item movement
    if (this.initialYOffset !== currentYOffset) {
      this.topOffsets = this.topOffsets.map(
        offset => offset - (currentYOffset - this.initialYOffset)
      );
      this.initialYOffset = currentYOffset;
    }
    this.afterIndex = binarySearch(this.topOffsets, itemVerticalCenter);
    this.animateItems(
      this.afterIndex === -1 ? 0 : this.afterIndex,
      this.state.itemDragged,
      offset
    );
  };

  animateItems = (
    needle: number,
    movedItem: number,
    offset: number,
    animateMovedItem: boolean = false
  ) => {
    this.items.forEach((item, i) => {
      setItemTransition(item, this.props.transitionDuration);
      if (movedItem === i && animateMovedItem) {
        if (movedItem === needle) {
          return transformItem(item, null);
        }
        transformItem(
          item,
          movedItem < needle
            ? this.itemTranslateOffsets
                .slice(movedItem + 1, needle + 1)
                .reduce((a, b) => a + b, 0)
            : this.itemTranslateOffsets
                .slice(needle, movedItem)
                .reduce((a, b) => a + b, 0) * -1
        );
      } else if (movedItem < needle && i > movedItem && i <= needle) {
        transformItem(item, -offset);
      } else if (i < movedItem && movedItem > needle && i >= needle) {
        transformItem(item, offset);
      } else {
        transformItem(item, null);
      }
    });
  };

  onEnd = () => {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('mouseup', this.onEnd);
    document.removeEventListener('touchup', this.onEnd);
    document.removeEventListener('touchcancel', this.onEnd);
    if (this.afterIndex > -1 && this.state.itemDragged !== this.afterIndex) {
      this.props.onChange({
        oldIndex: this.state.itemDragged,
        newIndex: this.afterIndex
      });
    }
    this.items.forEach(item => {
      setItemTransition(item, 0);
      transformItem(item, null);
    });
    this.setState({ itemDragged: -1 });
    this.afterIndex = -2;
    // sometimes the scroll gets messed up after the drop, fix:
    if (this.lastScroll > 0) {
      this.listRef.current!.scrollTop = this.lastScroll;
      this.lastScroll = 0;
    }
  };

  onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const selectedItem = this.state.selectedItem;
    if (e.key === ' ') {
      e.preventDefault();
      if (selectedItem === index) {
        if (selectedItem !== this.needle) {
          this.items.forEach(item => {
            setItemTransition(item, 0);
            transformItem(item, null);
          });
          this.props.onChange({
            oldIndex: selectedItem,
            newIndex: this.needle
          });
        }
        this.setState({
          selectedItem: -1,
          liveText: this.props.voiceover.dropped(
            selectedItem + 1,
            this.needle + 1
          )
        });
        this.needle = -1;
      } else {
        this.setState({
          selectedItem: index,
          liveText: this.props.voiceover.lifted(index + 1)
        });
        this.needle = index;
      }
    }
    if (
      (e.key === 'ArrowDown' || e.key === 'j') &&
      selectedItem > -1 &&
      this.needle < this.props.values.length - 1
    ) {
      e.preventDefault();
      const offset = getTranslateOffset(this.items[selectedItem]);
      this.needle++;
      this.animateItems(this.needle, selectedItem, offset, true);
      this.setState({
        liveText: this.props.voiceover.moved(this.needle + 1, false)
      });
    }
    if (
      (e.key === 'ArrowUp' || e.key === 'k') &&
      selectedItem > -1 &&
      this.needle > 0
    ) {
      e.preventDefault();
      const offset = getTranslateOffset(this.items[selectedItem]);
      this.needle--;
      this.animateItems(this.needle, selectedItem, offset, true);
      this.setState({
        liveText: this.props.voiceover.moved(this.needle + 1, true)
      });
    }
    if (e.key === 'Escape' && selectedItem > -1) {
      this.items.forEach(item => {
        setItemTransition(item, 0);
        transformItem(item, null);
      });
      this.setState({
        selectedItem: -1,
        liveText: this.props.voiceover.canceled(selectedItem + 1)
      });
      this.needle = -1;
    }
    if ((e.key === 'Tab' || e.key === 'Enter') && selectedItem > -1) {
      e.preventDefault();
    }
  };

  render() {
    return (
      <React.Fragment>
        {this.props.render({
          items: this.props.values.map((value, index) => {
            const itemProps: IBaseItemProps = {
              index,
              isDragged: index === this.state.itemDragged,
              isSelected: index === this.state.selectedItem,
              isActive:
                index === this.state.itemDragged ||
                index === this.state.selectedItem,
              onMouseStart: this.onMouseStart,
              onTouchStart: this.onTouchStart,
              onKeyDown: this.onKeyDown,
              setItemRef: (ref, index) => {
                this.items[index] = ref;
              },
              removeItemRef: index => {
                console.log(index);
                this.items = arrayRemove(this.items, index);
              },
              setGhostRef: ref => {
                this.ghostRef = ref;
              },
              ghostItemStyle: {
                top: this.state.targetY,
                left: this.state.targetX,
                width: this.state.targetWidth,
                height: this.state.targetHeight
              },
              voiceover: this.props.voiceover
            };
            return { value, itemProps };
          }),
          isDragged: this.state.itemDragged > -1,
          scrollProps: {
            onWheel: this.onWheel,
            ref: this.listRef
          }
        })}
        <div
          aria-live="assertive"
          role="log"
          aria-atomic="true"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            margin: '-1px',
            border: '0px',
            padding: '0px',
            overflow: 'hidden',
            clip: 'react(0px, 0px, 0px, 0px)',
            clipPath: 'inset(100%)'
          }}
        >
          {this.state.liveText}
        </div>
      </React.Fragment>
    );
  }
}

export default List;
