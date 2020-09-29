// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert, expect } from 'chai';
import { isEqual } from 'lodash';
import * as path from 'path';
import { EventEmitter } from 'vscode';
import { PythonEnvInfo, PythonEnvKind } from '../../../../../client/pythonEnvironments/base/info';
import { PythonEnvUpdatedEvent } from '../../../../../client/pythonEnvironments/base/locator';
import {
    mergeEnvironments,
    PythonEnvsReducer,
} from '../../../../../client/pythonEnvironments/base/locators/composite/environmentsReducer';
import { PythonEnvsChangedEvent } from '../../../../../client/pythonEnvironments/base/watcher';
import { sleep } from '../../../../core';
import { createNamedEnv, getEnvs, SimpleLocator } from '../../common';

suite('Python envs locator - Environments Reducer', () => {
    suite('iterEnvs()', () => {
        test('Iterator only yields unique environments', async () => {
            const env1 = createNamedEnv('env1', '3.5', PythonEnvKind.Venv, path.join('path', 'to', 'exec1'));
            const env2 = createNamedEnv('env2', '3.8', PythonEnvKind.Conda, path.join('path', 'to', 'exec2'));
            const env3 = createNamedEnv('env3', '2.7', PythonEnvKind.System, path.join('path', 'to', 'exec3'));
            const env4 = createNamedEnv('env4', '3.8.1', PythonEnvKind.Unknown, path.join('path', 'to', 'exec2')); // Same as env2
            const env5 = createNamedEnv('env5', '3.5.12b1', PythonEnvKind.Venv, path.join('path', 'to', 'exec1')); // Same as env1
            const environmentsToBeIterated = [env1, env2, env3, env4, env5]; // Contains 3 unique environments
            const parentLocator = new SimpleLocator(environmentsToBeIterated);
            const reducer = new PythonEnvsReducer(parentLocator);

            const iterator = reducer.iterEnvs();
            const envs = await getEnvs(iterator);

            const expected = [env1, env2, env3];
            assert.deepEqual(envs, expected);
        });

        test('Single updates for multiple environments are sent correctly followed by the null event', async () => {
            // Arrange
            const env1 = createNamedEnv('env1', '3.5', PythonEnvKind.Unknown, path.join('path', 'to', 'exec1'));
            const env2 = createNamedEnv('env2', '3.8', PythonEnvKind.Unknown, path.join('path', 'to', 'exec2'));
            const env3 = createNamedEnv('env3', '2.7', PythonEnvKind.System, path.join('path', 'to', 'exec3'));
            const env4 = createNamedEnv('env4', '3.8.1', PythonEnvKind.Conda, path.join('path', 'to', 'exec2')); // Same as env2;
            const env5 = createNamedEnv('env5', '3.5.12b1', PythonEnvKind.Venv, path.join('path', 'to', 'exec1')); // Same as env1;
            const environmentsToBeIterated = [env1, env2, env3, env4, env5]; // Contains 3 unique environments
            const parentLocator = new SimpleLocator(environmentsToBeIterated);
            const onUpdatedEvents: (PythonEnvUpdatedEvent | null)[] = [];
            const reducer = new PythonEnvsReducer(parentLocator);

            const iterator = reducer.iterEnvs(); // Act

            // Assert
            let { onUpdated } = iterator;
            expect(onUpdated).to.not.equal(undefined, '');

            // Arrange
            onUpdated = onUpdated!;
            onUpdated((e) => {
                onUpdatedEvents.push(e);
            });

            // Act
            await getEnvs(iterator);
            await sleep(1); // Resolve pending calls in the background

            // Assert
            const expectedUpdates = [
                { index: 1, old: env2, update: mergeEnvironments(env2, env4) },
                { index: 0, old: env1, update: mergeEnvironments(env1, env5) },
                null,
            ];
            assert.deepEqual(expectedUpdates, onUpdatedEvents);
        });

        test('Multiple updates for the same environment are sent correctly followed by the null event', async () => {
            // Arrange
            const env1 = createNamedEnv('env1', '3.8', PythonEnvKind.Unknown, path.join('path', 'to', 'exec'));
            const env2 = createNamedEnv('env2', '3.8.1', PythonEnvKind.System, path.join('path', 'to', 'exec'));
            const env3 = createNamedEnv('env3', '3.8.1', PythonEnvKind.Conda, path.join('path', 'to', 'exec'));
            const environmentsToBeIterated = [env1, env2, env3]; // All refer to the same environment
            const parentLocator = new SimpleLocator(environmentsToBeIterated);
            const onUpdatedEvents: (PythonEnvUpdatedEvent | null)[] = [];
            const reducer = new PythonEnvsReducer(parentLocator);

            const iterator = reducer.iterEnvs(); // Act

            // Assert
            let { onUpdated } = iterator;
            expect(onUpdated).to.not.equal(undefined, '');

            // Arrange
            onUpdated = onUpdated!;
            onUpdated((e) => {
                onUpdatedEvents.push(e);
            });

            // Act
            await getEnvs(iterator);
            await sleep(1); // Resolve pending calls in the background

            // Assert
            const env12 = mergeEnvironments(env1, env2);
            const env123 = mergeEnvironments(env12, env3);
            const expectedUpdates: (PythonEnvUpdatedEvent | null)[] = [];
            if (isEqual(env12, env123)) {
                expectedUpdates.push(
                    { index: 0, old: env1, update: env12 },
                    null,
                );
            } else {
                expectedUpdates.push(
                    { index: 0, old: env1, update: env12 },
                    { index: 0, old: env12, update: env123 },
                    null,
                );
            }
            assert.deepEqual(onUpdatedEvents, expectedUpdates);
        });

        test('Updates to environments from the incoming iterator are passed on correctly followed by the null event', async () => {
            // Arrange
            const env1 = createNamedEnv('env1', '3.8', PythonEnvKind.Unknown, path.join('path', 'to', 'exec'));
            const env2 = createNamedEnv('env2', '3.8.1', PythonEnvKind.System, path.join('path', 'to', 'exec'));
            const environmentsToBeIterated = [env1];
            const didUpdate = new EventEmitter<PythonEnvUpdatedEvent | null>();
            const parentLocator = new SimpleLocator(environmentsToBeIterated, { onUpdated: didUpdate.event });
            const onUpdatedEvents: (PythonEnvUpdatedEvent | null)[] = [];
            const reducer = new PythonEnvsReducer(parentLocator);

            const iterator = reducer.iterEnvs(); // Act

            // Assert
            let { onUpdated } = iterator;
            expect(onUpdated).to.not.equal(undefined, '');

            // Arrange
            onUpdated = onUpdated!;
            onUpdated((e) => {
                onUpdatedEvents.push(e);
            });

            // Act
            await getEnvs(iterator);
            didUpdate.fire({ index: 0, old: env1, update: env2 });
            didUpdate.fire(null); // It is essential for the incoming iterator to fire "null" event signifying it's done
            await sleep(1);

            // Assert
            const expectedUpdates = [
                { index: 0, old: env1, update: mergeEnvironments(env1, env2) },
                null,
            ];
            assert.deepEqual(expectedUpdates, onUpdatedEvents);
            didUpdate.dispose();
        });
    });

    test('onChanged fires iff onChanged from locator manager fires', () => {
        const parentLocator = new SimpleLocator([]);
        const event1: PythonEnvsChangedEvent = {};
        const event2: PythonEnvsChangedEvent = { kind: PythonEnvKind.Unknown };
        const expected = [event1, event2];
        const reducer = new PythonEnvsReducer(parentLocator);

        const events: PythonEnvsChangedEvent[] = [];
        reducer.onChanged((e) => events.push(e));

        parentLocator.fire(event1);
        parentLocator.fire(event2);

        assert.deepEqual(events, expected);
    });

    suite('resolveEnv()', () => {
        test('Iterates environments from the reducer to get resolved environment, then calls into locator manager to resolve environment further and return it', async () => {
            const env1 = createNamedEnv('env1', '3.8', PythonEnvKind.Unknown, path.join('path', 'to', 'exec'));
            const env2 = createNamedEnv('env2', '2.7', PythonEnvKind.System, path.join('path', 'to', 'exec3'));
            const env3 = createNamedEnv('env3', '3.8.1', PythonEnvKind.Conda, path.join('path', 'to', 'exec'));
            const env4 = createNamedEnv('env4', '3.8.1', PythonEnvKind.Conda, path.join('path', 'to', 'exec2'));
            const env5 = createNamedEnv('env5', '3.5.12b1', PythonEnvKind.Venv, path.join('path', 'to', 'exec1'));
            const env6 = createNamedEnv('env6', '3.8.1', PythonEnvKind.System, path.join('path', 'to', 'exec'));
            const environmentsToBeIterated = [env1, env2, env3, env4, env5, env6]; // env1 env3 env6 are same

            const env13 = mergeEnvironments(env1, env3);
            const env136 = mergeEnvironments(env13, env6);
            const expected = createNamedEnv('resolvedEnv', '3.8.1', PythonEnvKind.Conda, 'resolved/path/to/exec');
            const parentLocator = new SimpleLocator(environmentsToBeIterated, {
                resolve: async (e: PythonEnvInfo) => {
                    if (isEqual(e, env136)) {
                        return expected;
                    }
                    return undefined;
                },
            });
            const reducer = new PythonEnvsReducer(parentLocator);

            // Trying to resolve the environment corresponding to env1 env3 env6
            const resolved = await reducer.resolveEnv(path.join('path', 'to', 'exec'));

            assert.deepEqual(resolved, expected);
        });

        test("If the reducer isn't able to resolve environment, return undefined", async () => {
            const env1 = createNamedEnv('env1', '3.8', PythonEnvKind.Unknown, path.join('path', 'to', 'exec'));
            const env2 = createNamedEnv('env2', '2.7', PythonEnvKind.System, path.join('path', 'to', 'exec3'));
            const env3 = createNamedEnv('env3', '3.8.1', PythonEnvKind.Conda, path.join('path', 'to', 'exec'));
            const env4 = createNamedEnv('env4', '3.8.1', PythonEnvKind.Conda, path.join('path', 'to', 'exec2'));
            const env5 = createNamedEnv('env5', '3.5.12b1', PythonEnvKind.Venv, path.join('path', 'to', 'exec1'));
            const env6 = createNamedEnv('env6', '3.8.1', PythonEnvKind.System, path.join('path', 'to', 'exec'));
            const environmentsToBeIterated = [env1, env2, env3, env4, env5, env6]; // env1 env3 env6 are same

            const env13 = mergeEnvironments(env1, env3);
            const env136 = mergeEnvironments(env13, env6);
            const parentLocator = new SimpleLocator(environmentsToBeIterated, {
                resolve: async (e: PythonEnvInfo) => {
                    if (isEqual(e, env136)) {
                        return createNamedEnv('resolvedEnv', '3.8.1', PythonEnvKind.Conda, 'resolved/path/to/exec');
                    }
                    return undefined;
                },
            });
            const reducer = new PythonEnvsReducer(parentLocator);

            const expected = await reducer.resolveEnv(path.join('path', 'to', 'execNeverSeenBefore'));

            assert.deepEqual(expected, undefined);
        });
    });
});
