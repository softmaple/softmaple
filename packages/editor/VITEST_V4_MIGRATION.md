# Vitest 4 Migration Status

## Completed Changes

1. ✅ **Updated setupFiles path** - Changed from `.storybook/vitest.setup.ts` to `./.storybook/vitest.setup.ts` for Vitest 4 compatibility
2. ✅ **Updated dependencies** - Upgraded to Vitest 4.0.13 and @vitest/coverage-v8 4.0.13
3. ✅ **Updated @vitest/browser** - Upgraded to 4.0.13

## Known Issues

### Storybook Addon Compatibility

**Issue**: `@storybook/addon-vitest@9.1.1` has peer dependency on `vitest: ^3.0.0`, but we're using Vitest 4.0.13.

**Impact**: Warning during installation, but tests may still work. The addon-vitest plugin is used for running Storybook stories as Vitest tests.

**Resolution Options**:

1. **Wait for Storybook 10** - Latest `@storybook/addon-vitest` (10.x) supports `vitest: ^3.0.0 || ^4.0.0`
2. **Ignore peer dependency warnings** - Current setup may still function
3. **Temporarily disable Storybook tests** - Remove storybook workspace from vitest.workspace.ts

## Migration Guide Applied

Following https://vitest.dev/guide/migration#vitest-4:

- ✅ Updated setupFiles paths to be explicit with `./` prefix
- ✅ Verified browser.provider is set to "playwright" (required for Vitest 4)
- ✅ Coverage provider v8 is properly configured

## Testing

To verify the migration:

```bash
# Run Storybook tests (may show peer dependency warning)
pnpm --filter @softmaple/editor test:storybook

# Run coverage
pnpm --filter @softmaple/editor coverage
```
