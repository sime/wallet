import { useCallback, useEffect, useReducer } from 'react'

import WalletConnectCore from '@walletconnect/core'
import * as cryptoLib from '@walletconnect/iso-crypto'

const noop = () => null
const noopSessionStorage = { setSession: noop, getSession: noop, removeSession: noop }

const STORAGE_KEY = 'wc1_connections'
const SUPPORTED_METHODS = ['eth_sendTransaction', 'gs_multi_send', 'personal_sign', 'eth_sign']

const getDefaultState = () => ({ connectors: {}, connections: [] })

export default function useWalletConnect ({ account, chainId, onCallRequest }) {
    const [state, dispatch] = useReducer((state, action) => {
        if (action.type === 'updateConnections') return { ...state, connections: action.connections }
        if (action.type === 'addConnectors') {
            return { ...state, connectors: { ...state.connectors, ...action.newConnectors } }   
        }
        if (action.type === 'connectedNewSession') {
            const connector = action.connector

            // It's safe to read .session right after approveSession because 1) approveSession itself normally stores the session itself
            // 2) connector.session is a getter that re-reads private properties of the connector; those properties are updated immediately at approveSession
            return {
                connections: [...state.connections, { uri: action.uri, session: connector.session }],
                connectors: { ...state.connectors, [action.uri]: connector }
            }
        }
        if (action.type === 'disconnected') {
            return {
                connections: state.connections.filter(x => x.uri !== action.uri),
                connectors: { ...state.connectors, [action.uri]: undefined }
            }
        }
        return { ...state }
    }, null, () => {
        try {
            return {
                connections: JSON.parse(localStorage[STORAGE_KEY]),
                connectors: {}
            }
        } catch(e) {
            console.error(e)
            return getDefaultState()
        }
    })

    const connect = useCallback(connectorOpts => {
        if (state.connectors[connectorOpts.uri]) return state.connectors[connectorOpts.uri]
        const connector = new WalletConnectCore({
            connectorOpts,
            cryptoLib,
            sessionStorage: noopSessionStorage
        })

        connector.on('session_request', (error, payload) => {
            // While technically we may have an outdated account/chainId here, we do not care
            // because the useEffect that updates sessions will catch it on the next re-render and update accordingly
            connector.approveSession({
                accounts: [account],
                chainId: chainId,
            })
            dispatch({ type: 'connectedNewSession', uri: connectorOpts.uri, connector })
        })

        connector.on('call_request', async (error, payload) => {
            // @TODO how to handle this err?
            if (error) throw error
            if (!SUPPORTED_METHODS.includes(payload.method)) {
                connector.rejectRequest({ id: payload.id, error: { message: 'METHOD_NOT_SUPPORTED' }})
                return
            }
            // Is there a more elegant way of getting the latest onCallRequest than routing back to the reducer?
            // @TODO: pending requests or something
            // we can store them in case we need them later (pending)
            // @TODO: we need a way to know the latest account, chainId here; or just replace it with the thing on the prev comment
            onCallRequest(payload, connector)
                .catch(e => console.error(e))            /*
            try {
                await onCallRequest(payload, connector)
            } catch (err) {
                // @TODO: shouldn't we make this an internal error too?
                console.error(err)
                connector.rejectRequest({ id: payload.id, error: { message: err.message }})
            }
            */
        })

        connector.on('disconnect', (error, payload) => {
            // @TODO how to handle this err?
            if (error) throw error
            dispatch({ type: 'disconnected', uri: connectorOpts.uri })
        })

        return connector
    }, [state.connectors, account, chainId])

    const disconnect = useCallback(uri => {
        if (state.connectors[uri]) state.connectors[uri].killSession()
        dispatch({ type: 'disconnected', uri })
    }, [state])

    // Side effects that will run on every state change/rerender
    useEffect(() => {
        // restore connectors and update the ones that are stale
        let newConnectors = {}
        let updateConnections = false
        state.connections.forEach(({ uri, session }) => {
            if (!state.connectors[uri]) newConnectors[uri] = connect({ uri, session })
            else {
                const connector = state.connectors[uri]
                const session = connector.session
                if (session.accounts[0] !== account || session.chainId !== chainId) {
                    connector.updateSession({ accounts: [account], chainId })
                    updateConnections = true
                }
            }
        })
        
        localStorage[STORAGE_KEY] = JSON.stringify(state.connections)

        if (updateConnections) dispatch({
            type: 'updateConnections',
            connections: state.connections.map(({ uri }) => ({ uri, session: state.connectors[uri].session }))
        })
        if (Object.keys(newConnectors).length) dispatch({ type: 'addConnectors', newConnectors })
    }, [state, connect, account, chainId])

    // Initialization effects
    useEffect(() => runInitEffects(connect), [])

    return { connections: state.connections, connect, disconnect }
}

// Initialization side effects
// Connect to the URL, read from clipboard, etc.
function runInitEffects(wcConnect) {
    const query = new URLSearchParams(window.location.href.split('?').slice(1).join('?'))
    const wcUri = query.get('uri')
    if (wcUri) wcConnect({ uri: wcUri })
    // @TODO only on init; perhaps put this in the hook itself

    // hax
    window.wcConnect = uri => wcConnect({ uri })

    // @TODO on focus and on user action
    const clipboardError = e => console.log('non-fatal clipboard err', e)
    var isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1
    if (!isFirefox) {
        navigator.permissions.query({ name: 'clipboard-read' }).then((result) => {
            // If permission to read the clipboard is granted or if the user will
            // be prompted to allow it, we proceed.
    
            if (result.state === 'granted' || result.state === 'prompt') {
                navigator.clipboard.readText().then(clipboard => {
                    if (clipboard.startsWith('wc:')) wcConnect({ uri: clipboard })
                }).catch(clipboardError)
            }
            // @TODO show the err to the user if they triggered the action
        }).catch(clipboardError)
    }
}