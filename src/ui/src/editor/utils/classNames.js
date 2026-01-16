/**
 * Utility for consistent className construction.
 *
 * ## Why this file exists
 * - Provides a consistent way to combine class names
 * - Handles conditional classes cleanly
 * - Filters out falsy values automatically
 */

/**
 * Combine class names, filtering out falsy values.
 *
 * @param {...(string | boolean | null | undefined)} classes - Class names to combine
 * @returns {string} - Combined class string
 *
 * @example
 * cn('base', isActive && 'active', 'always')
 * // => 'base active always' (if isActive is true)
 * // => 'base always' (if isActive is false)
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Create a conditional class string based on a condition.
 *
 * @param {boolean} condition - The condition to check
 * @param {string} trueClass - Class to use when condition is true
 * @param {string} [falseClass=''] - Class to use when condition is false
 * @returns {string}
 *
 * @example
 * conditionalClass(isOpen, 'rotate-180', '')
 * // => 'rotate-180' when isOpen is true
 * // => '' when isOpen is false
 */
export function conditionalClass(condition, trueClass, falseClass = '') {
  return condition ? trueClass : falseClass;
}

/**
 * Common button style combinations.
 */
export const buttonStyles = {
  base: 'rounded transition-colors',
  primary: 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400',
  secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  ghost: 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40',
  active: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
  toolbar: 'p-1 min-w-[24px] h-[26px] flex items-center justify-center',
};

/**
 * Common text style combinations.
 */
export const textStyles = {
  label: 'text-xs font-medium text-gray-500 dark:text-slate-400',
  labelActive: 'text-xs font-medium text-blue-600 dark:text-blue-300',
  heading: 'font-semibold text-gray-900 dark:text-slate-100',
  body: 'text-sm text-gray-700 dark:text-slate-300',
  muted: 'text-xs text-gray-400 dark:text-slate-500',
};

export default cn;
