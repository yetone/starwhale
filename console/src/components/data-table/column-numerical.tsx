/* eslint-disable */
/*
Copyright (c) Uber Technologies, Inc.

This source code is licensed under the MIT license found in the
LICENSE file in the root directory of this source tree.
*/

import * as React from 'react'

import { Button, SIZE } from 'baseui/button'
import { ButtonGroup, MODE } from 'baseui/button-group'
import { Input, SIZE as INPUT_SIZE } from 'baseui/input'
import { useStyletron } from 'baseui'

import Column from './column'
import { COLUMNS, NUMERICAL_FORMATS, MAX_BIN_COUNT, HISTOGRAM_SIZE } from './constants'
import FilterShell, { type ExcludeKind } from './filter-shell'
import type { ColumnT, SharedColumnOptionsT } from './types'
import { LocaleContext } from './locales'
// @ts-ignore
import { bin, max as maxFunc, extent, scaleLinear, median, bisector } from 'd3'
import { Slider } from 'baseui/slider'

type NumericalFormats =
    | typeof NUMERICAL_FORMATS.DEFAULT
    | typeof NUMERICAL_FORMATS.ACCOUNTING
    | typeof NUMERICAL_FORMATS.PERCENTAGE

type OptionsT = {
    format?: NumericalFormats | ((value: number) => string)
    highlight?: (n: number) => boolean
    precision?: number
} & SharedColumnOptionsT<number>

type FilterParametersT = {
    lowerValue: number
    upperValue: number
    description: string
    exclude: boolean
    excludeKind: ExcludeKind
}

type NumericalColumnT = ColumnT<number, FilterParametersT>

function roundToFixed(value: number, precision: number) {
    const k = Math.pow(10, precision)
    return Math.round(value * k) / k
}

function format(value: number, options: any) {
    if (typeof options.format === 'function') {
        return options.format(value)
    }
    let formatted = value.toString()
    switch (options.format) {
        case NUMERICAL_FORMATS.ACCOUNTING: {
            const abs = Math.abs(value)
            if (value < 0) {
                formatted = `($${roundToFixed(abs, options.precision)})`
                break
            }
            formatted = `$${roundToFixed(abs, options.precision)}`
            break
        }
        case NUMERICAL_FORMATS.PERCENTAGE: {
            formatted = `${roundToFixed(value, options.precision)}%`
            break
        }
        case NUMERICAL_FORMATS.DEFAULT:
        default:
            // @ts-ignore
            formatted = roundToFixed(value, options.precision)
            break
    }
    return formatted
}

// @ts-ignore
function validateInput(input) {
    return Boolean(parseFloat(input)) || input === '' || input === '-'
}
// @ts-ignore
const bisect = bisector((d) => d.x0)
// @ts-ignore
const Histogram = React.memo(function Histogram({ data, lower, upper, isRange, exclude, precision }) {
    const [css, theme] = useStyletron()

    const { bins, xScale, yScale } = React.useMemo(() => {
        const bins = bin().thresholds(Math.min(data.length, MAX_BIN_COUNT))(data)

        const xScale = scaleLinear()
            .domain([bins[0].x0, bins[bins.length - 1].x1])
            .range([0, HISTOGRAM_SIZE.width])
            .clamp(true)

        const yScale = scaleLinear()
            // @ts-ignore
            .domain([0, maxFunc(bins, (d) => d.length)])
            .nice()
            .range([HISTOGRAM_SIZE.height, 0])
        return { bins, xScale, yScale }
    }, [data])

    // We need to find the index of bar which is nearest to the given single value
    const singleIndexNearest = React.useMemo(() => {
        if (isRange) {
            return null
        } // @ts-ignore
        return bisect.center(bins, lower)
    }, [isRange, data, lower, upper])

    return (
        <div
            className={css({
                display: 'flex',
                marginTop: theme.sizing.scale600,
                marginLeft: theme.sizing.scale200,
                marginRight: 0,
                marginBottom: theme.sizing.scale400,
                justifyContent: 'space-between',
                overflow: 'visible',
            })}
        >
            <svg {...HISTOGRAM_SIZE}>
                {/* @ts-ignore */}
                {bins.map((d, index) => {
                    const x = xScale(d.x0) + 1
                    const y = yScale(d.length)
                    const width = Math.max(0, xScale(d.x1) - xScale(d.x0) - 1)
                    const height = yScale(0) - yScale(d.length)

                    let included
                    if (singleIndexNearest != null) {
                        included = index === singleIndexNearest
                    } else {
                        const withinLower = d.x1 > lower
                        const withinUpper = d.x0 <= upper
                        included = withinLower && withinUpper
                    }

                    if (exclude) {
                        included = !included
                    }

                    return (
                        <rect
                            key={`bar-${index}`}
                            fill={included ? theme.colors.primary : theme.colors.mono400}
                            x={x}
                            y={y}
                            width={width}
                            height={height}
                        />
                    )
                })}
            </svg>
        </div>
    )
})

// @ts-ignore
function NumericalFilter(props) {
    const [css, theme] = useStyletron()
    const locale = React.useContext(LocaleContext)

    const precision = props.options.precision

    // The state handling of this component could be refactored and cleaned up if we used useReducer.
    const initialState = React.useMemo(() => {
        return (
            props.filterParams || {
                exclude: false,
                excludeKind: 'range',
                comparatorIndex: 0,
                lowerValue: null,
                upperValue: null,
            }
        )
    }, [props.filterParams])

    const [exclude, setExclude] = React.useState(initialState.exclude)

    // the api of our ButtonGroup forces these numerical indexes...
    // TODO look into allowing semantic names, similar to the radio component. Tricky part would be backwards compat
    const [comparatorIndex, setComparatorIndex] = React.useState(() => {
        switch (initialState.excludeKind) {
            case 'value':
                return 1
            case 'range':
            default:
                // fallthrough
                return 0
        }
    })

    // We use the d3 function to get the extent as it's a little more robust to null, -Infinity, etc.
    const [min, max] = React.useMemo(() => extent(props.data), [props.data])

    const [lv, setLower] = React.useState<number>(() => roundToFixed(initialState.lowerValue || min, precision))
    const [uv, setUpper] = React.useState<number>(() => roundToFixed(initialState.upperValue || max, precision))

    // We keep a separate value for the single select, to give a user the ability to toggle between
    // the range and single values without losing their previous input.
    const [sv, setSingle] = React.useState<number>(() =>
        roundToFixed(initialState.lowerValue || median(props.data), precision)
    )

    // This is the only conditional which we want to use to determine
    // if we are in range or single value mode.
    // Don't derive it via something else, e.g. lowerValue === upperValue, etc.
    const isRange = comparatorIndex === 0

    const excludeKind = isRange ? 'range' : 'value'

    // while the user is inputting values, we take their input at face value,
    // if we don't do this, a user can't input partial numbers, e.g. "-", or "3."
    const [focused, setFocus] = React.useState(false)
    const [inputValueLower, inputValueUpper] = React.useMemo(() => {
        if (focused) {
            return [isRange ? lv : sv, uv]
        }

        // once the user is done inputting.
        // we validate then format to the given precision
        let l = isRange ? lv : sv
        l = validateInput(l) ? l : min
        let h = validateInput(uv) ? uv : max

        return [roundToFixed(l, precision), roundToFixed(h, precision)]
    }, [isRange, focused, sv, lv, uv, precision])

    // We have our slider values range from 1 to the bin size, so we have a scale which
    // takes in the data driven range and maps it to values the scale can always handle
    const sliderScale = React.useMemo(
        () =>
            scaleLinear()
                .domain([min, max])
                .rangeRound([1, MAX_BIN_COUNT])
                // We clamp the values within our min and max even if a user enters a huge number
                .clamp(true),
        [min, max]
    )

    let sliderValue = isRange
        ? [sliderScale(inputValueLower), sliderScale(inputValueUpper)]
        : [sliderScale(inputValueLower)]

    // keep the slider happy by sorting the two values
    if (isRange && sliderValue[0] > sliderValue[1]) {
        sliderValue = [sliderValue[1], sliderValue[0]]
    }

    return (
        <FilterShell
            exclude={exclude}
            onExcludeChange={() => setExclude(!exclude)}
            excludeKind={excludeKind}
            onApply={() => {
                if (isRange) {
                    // @ts-ignore
                    const lowerValue = parseFloat(inputValueLower)
                    // @ts-ignore
                    const upperValue = parseFloat(inputValueUpper)
                    props.setFilter({
                        description: `≥ ${lowerValue} and ≤ ${upperValue}`,
                        exclude: exclude,
                        lowerValue,
                        upperValue,
                        excludeKind,
                    })
                } else {
                    // @ts-ignore
                    const value = parseFloat(inputValueLower)
                    props.setFilter({
                        description: `= ${value}`,
                        exclude: exclude,
                        lowerValue: inputValueLower,
                        upperValue: inputValueLower,
                        excludeKind,
                    })
                }

                props.close()
            }}
        >
            <ButtonGroup
                size={SIZE.mini}
                mode={MODE.radio}
                selected={comparatorIndex}
                onClick={(_, index) => setComparatorIndex(index)}
                overrides={{
                    Root: {
                        style: ({ $theme }) => ({ marginBottom: $theme.sizing.scale300 }),
                    },
                }}
            >
                <Button
                    type='button'
                    overrides={{ BaseButton: { style: { width: '100%' } } }}
                    aria-label={locale.datatable.numericalFilterRange}
                >
                    {locale.datatable.numericalFilterRange}
                </Button>
                <Button
                    type='button'
                    overrides={{ BaseButton: { style: { width: '100%' } } }}
                    aria-label={locale.datatable.numericalFilterSingleValue}
                >
                    {locale.datatable.numericalFilterSingleValue}
                </Button>
            </ButtonGroup>
            <Histogram
                // @ts-ignore
                data={props.data}
                lower={inputValueLower}
                upper={inputValueUpper}
                isRange={isRange}
                exclude={exclude}
                precision={props.options.precision}
            />
            <div className={css({ display: 'flex', justifyContent: 'space-between' })}>
                <Slider
                    // The slider throws errors when switching between single and two values
                    // when it tries to read getThumbDistance on a thumb which is not there anymore
                    // if we create a new instance these errors are prevented.
                    key={isRange.toString()}
                    min={1}
                    max={MAX_BIN_COUNT}
                    value={sliderValue}
                    onChange={({ value }) => {
                        if (!value) {
                            return
                        }
                        // we convert back from the slider scale to the actual data's scale
                        if (isRange) {
                            const [lowerValue, upperValue] = value
                            setLower(sliderScale.invert(lowerValue))
                            setUpper(sliderScale.invert(upperValue))
                        } else {
                            const [singleValue] = value
                            setSingle(sliderScale.invert(singleValue))
                        }
                    }}
                    overrides={{
                        InnerThumb: function InnerThumb({ $value, $thumbIndex }) {
                            return <React.Fragment>{$value[$thumbIndex]}</React.Fragment>
                        },
                        TickBar: ({ $min, $max }) => null, // we don't want the ticks
                        ThumbValue: () => null,
                        Root: {
                            style: () => ({
                                // Aligns the center of the slider handles with the histogram bars
                                width: 'calc(100% + 14px)',
                                margin: '0 -7px',
                            }),
                        },
                        InnerTrack: {
                            // @ts-ignore
                            style: ({ $theme }) => {
                                if (!isRange) {
                                    return {
                                        // For range selection we use the color as is, but when selecting the single value,
                                        // we don't want the track standing out, so mute its color
                                        background: theme.colors.mono400,
                                    }
                                }
                            },
                        },
                        Thumb: {
                            style: () => ({
                                // Slider handles are small enough to visually be centered within each histogram bar
                                height: '18px',
                                width: '18px',
                                fontSize: '0px',
                            }),
                        },
                    }}
                />
            </div>
            <div
                className={css({
                    display: 'flex',
                    marginTop: theme.sizing.scale400,
                    // This % gap is visually appealing given the filter box width
                    gap: '30%',
                    justifyContent: 'space-between',
                })}
            >
                <Input
                    min={min}
                    max={max}
                    size={INPUT_SIZE.mini}
                    overrides={{ Root: { style: { width: '100%' } } }}
                    value={inputValueLower}
                    onChange={(event) => {
                        // @ts-ignore
                        if (validateInput(event.target.value)) {
                            isRange
                                ? // $FlowFixMe - we know it is a number by now
                                  // @ts-ignore
                                  setLower(event.target.value)
                                : // $FlowFixMe - we know it is a number by now
                                  // @ts-ignore
                                  setSingle(event.target.value)
                        }
                    }}
                    onFocus={() => setFocus(true)}
                    onBlur={() => setFocus(false)}
                />
                {isRange && (
                    <Input
                        min={min}
                        max={max}
                        size={INPUT_SIZE.mini}
                        overrides={{
                            Input: { style: { textAlign: 'right' } },
                            Root: { style: { width: '100%' } },
                        }}
                        value={inputValueUpper}
                        onChange={(event) => {
                            // @ts-ignore
                            if (validateInput(event.target.value)) {
                                // $FlowFixMe - we know it is a number by now
                                // @ts-ignore
                                setUpper(event.target.value)
                            }
                        }}
                        onFocus={() => setFocus(true)}
                        onBlur={() => setFocus(false)}
                    />
                )}
            </div>
        </FilterShell>
    )
}
// @ts-ignore
function NumericalCell(props) {
    const [css, theme] = useStyletron()
    return (
        <div
            className={css({
                ...theme.typography.MonoParagraphXSmall,
                display: 'flex',
                justifyContent: theme.direction !== 'rtl' ? 'flex-end' : 'flex-start',
                // @ts-ignore
                color: props.highlight(props.value) ? theme.colors.contentNegative : null,
                width: '100%',
            })}
            title={props.value}
        >
            {format(props.value, {
                format: props.format,
                precision: props.precision,
            })}
        </div>
    )
}

const defaultOptions = {
    title: '',
    sortable: true,
    filterable: true,
    format: NUMERICAL_FORMATS.DEFAULT,
    highlight: (n: number) => false,
    precision: 0,
}

function NumericalColumn(options: OptionsT): NumericalColumnT {
    const normalizedOptions = {
        ...defaultOptions,
        ...options,
    }

    if (
        normalizedOptions.format !== NUMERICAL_FORMATS.DEFAULT &&
        (options.precision === null || options.precision === undefined)
    ) {
        normalizedOptions.precision = 2
    }

    if (
        normalizedOptions.format === NUMERICAL_FORMATS.ACCOUNTING &&
        (options.highlight === null || options.highlight === undefined)
    ) {
        normalizedOptions.highlight = (n: number) => (n < 0) as boolean
    }

    return Column({
        kind: COLUMNS.NUMERICAL,
        buildFilter: function (params) {
            return function (data) {
                const value = roundToFixed(data, normalizedOptions.precision)
                const included = value >= params.lowerValue && value <= params.upperValue
                return params.exclude ? !included : included
            }
        },
        cellBlockAlign: options.cellBlockAlign,
        fillWidth: options.fillWidth,
        filterable: normalizedOptions.filterable,
        mapDataToValue: options.mapDataToValue,
        maxWidth: options.maxWidth,
        minWidth: options.minWidth,
        // @ts-ignore
        renderCell: function RenderNumericalCell(props) {
            return (
                <NumericalCell
                    {...props}
                    format={normalizedOptions.format}
                    highlight={normalizedOptions.highlight}
                    precision={normalizedOptions.precision}
                />
            )
        },
        // @ts-ignore
        renderFilter: function RenderNumericalFilter(props) {
            return <NumericalFilter {...props} options={normalizedOptions} />
        },
        sortable: normalizedOptions.sortable,
        sortFn: function (a, b) {
            return a - b
        },
        title: normalizedOptions.title,
        key: options.key,
        pin: options.pin,
    })
}

export default NumericalColumn
