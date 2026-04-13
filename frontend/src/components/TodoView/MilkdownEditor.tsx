import { useRef } from 'react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import styles from './MilkdownEditor.module.css';

interface Props {
  content: string;
  onChange: (markdown: string) => void;
}

function Inner({ content, onChange }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, content);
        ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
          onChangeRef.current(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
  );

  return <Milkdown />;
}

// key={fileKey} on this component forces a remount when the file changes
export default function MilkdownEditor({ content, onChange }: Props) {
  return (
    <MilkdownProvider>
      <div className={styles.editor}>
        <Inner content={content} onChange={onChange} />
      </div>
    </MilkdownProvider>
  );
}
