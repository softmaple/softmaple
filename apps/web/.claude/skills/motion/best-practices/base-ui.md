# Animating Base UI with Motion for React

Rules for integrating Motion animations with Base UI components.

## Adding Animations

Pass a `motion` component via the Base UI `render` prop:

```jsx
<Menu.Popup
  render={
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
  }
>
```

**Don't** use the function/spread props approach — it causes type errors.

## Exit Animations

### Standard Approach

For most components, use `AnimatePresence` with the `exit` prop as usual:

```jsx
<AnimatePresence>
  {open && (
    <Menu.Trigger
      render={
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      }
    />
  )}
</AnimatePresence>
```

### Self-Managing Components

Some Base UI components (e.g. `ContextMenu`, `Popover`) control their own conditional rendering. For exit animations on these:

1. **Hoist their open state** with `useState`:
   ```jsx
   const [open, setOpen] = useState(false)

   return (
     <ContextMenu.Root open={open} onOpenChange={setOpen}>
   ```

2. **Add `keepMounted` to `Portal`** and wrap with `AnimatePresence`:
   ```jsx
   <AnimatePresence>
     {open && (
       <ContextMenu.Portal keepMounted>
   ```

3. **Add exit animation** via `render` prop on a `motion` component:
   ```jsx
   <ContextMenu.Popup
     render={
       <motion.div
         initial={{ opacity: 0, transform: "scale(0.9)" }}
         animate={{ opacity: 1, transform: "scale(1)" }}
         exit={{ opacity: 0, transform: "scale(0.9)" }}
       />
     }
   >
   ```

### Full Example

```jsx
function App() {
  const [open, setOpen] = useState(false)

  return (
    <ContextMenu.Root open={open} onOpenChange={setOpen}>
      <ContextMenu.Trigger>Open menu</ContextMenu.Trigger>
      <AnimatePresence>
        {open && (
          <ContextMenu.Portal keepMounted>
            <ContextMenu.Positioner>
              <ContextMenu.Popup
                render={
                  <motion.div
                    initial={{ opacity: 0, transform: "scale(0.9)" }}
                    animate={{ opacity: 1, transform: "scale(1)" }}
                    exit={{ opacity: 0, transform: "scale(0.9)" }}
                  />
                }
              >
                {/* Children */}
              </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        )}
      </AnimatePresence>
    </ContextMenu.Root>
  )
}
```

**Note:** `Portal` keeps the tree mounted as long as Base UI detects animations via `element.getAnimations()`. Motion runs `opacity`, `transform`, `filter`, and `clipPath` via hardware acceleration — ensure at least one of these is used for exit animations.
